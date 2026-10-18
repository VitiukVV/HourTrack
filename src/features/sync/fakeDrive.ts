import { DRIVE_API_FILES_URL, DRIVE_API_UPLOAD_URL } from '@/lib/google/drive';

/**
 * An in-memory stand-in for the Drive appDataFolder, exposed as a `fetch`.
 *
 * `lib/google/drive.ts` takes a `fetchImpl` on every call, so a fake at that
 * seam exercises the REAL request building, etag handling, multipart upload
 * and error mapping — everything a hand-written response stub skips. That
 * matters because the interesting sync defects have all lived exactly there:
 * `If-Match` preconditions, the etag that Drive omits from upload replies,
 * and the merge that runs between a pull and the push that follows it.
 *
 * File contents are stored as JSON TEXT, so two "devices" pointed at one
 * FakeDrive can never share an object graph — a merge bug that mutates its
 * input in place shows up instead of being masked.
 *
 * Nothing here is imported by app code; it exists for
 * `syncEngine.e2e.test.ts` and any future conflict regression.
 *
 * Ported from my-diary's `src/features/sync/fakeDrive.ts`, rebuilt around
 * HourTrack's `fetchImpl` seam rather than its `DriveClient` interface.
 */

interface FakeDriveFile {
  id: string;
  name: string;
  /** Raw JSON text — see the round-trip note above. */
  content: string;
  etag: string;
  modifiedTime: string;
  appProperties: Record<string, string>;
}

export interface FakeDriveOptions {
  /** Access tokens the server should reject with 401. */
  revokedTokens?: Set<string>;
}

export class FakeDrive {
  private readonly files = new Map<string, FakeDriveFile>();
  private idCounter = 0;
  private etagCounter = 0;
  private clock = Date.parse('2026-01-01T00:00:00.000Z');
  private offline = false;
  private readonly revokedTokens: Set<string>;

  /** Call counters — used to assert that pushes coalesce rather than pile up. */
  reads = 0;
  writes = 0;

  constructor(options: FakeDriveOptions = {}) {
    this.revokedTokens = options.revokedTokens ?? new Set();
  }

  /** Airplane mode: every request rejects the way a real offline fetch does. */
  setOffline(value: boolean): void {
    this.offline = value;
  }

  /** Revoke a token so the next call from that "device" gets a 401. */
  revoke(token: string): void {
    this.revokedTokens.add(token);
  }

  /** Read a stored file's parsed contents — the assertion surface for tests. */
  read<T>(name: string): T | null {
    for (const file of this.files.values()) {
      if (file.name === name) return JSON.parse(file.content) as T;
    }
    return null;
  }

  /** Overwrite a file's contents out-of-band (simulates a third device). */
  write(name: string, data: unknown): void {
    for (const file of this.files.values()) {
      if (file.name === name) {
        file.content = JSON.stringify(data);
        file.etag = this.nextEtag();
        file.modifiedTime = this.nextTime();
        return;
      }
    }
    const id = `file-${++this.idCounter}`;
    this.files.set(id, {
      id,
      name,
      content: JSON.stringify(data),
      etag: this.nextEtag(),
      modifiedTime: this.nextTime(),
      appProperties: {},
    });
  }

  /** The `fetchImpl` to hand to `runBootstrap` / `SyncManager` / `drive.ts`. */
  readonly fetchImpl: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = normalizeHeaders(init?.headers);

    const auth = headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (!token || this.revokedTokens.has(token)) {
      return this.json(401, { error: { message: 'Invalid Credentials' } });
    }

    if (method === 'GET') this.reads += 1;
    else this.writes += 1;

    const base = `${url.origin}${url.pathname}`;

    // ---- upload endpoints ------------------------------------------------
    if (base === DRIVE_API_UPLOAD_URL && method === 'POST') {
      return this.create(String(init?.body ?? ''));
    }
    if (base.startsWith(`${DRIVE_API_UPLOAD_URL}/`) && method === 'PATCH') {
      const id = decodeURIComponent(base.slice(DRIVE_API_UPLOAD_URL.length + 1));
      return this.updateContent(id, String(init?.body ?? ''), headers['if-match']);
    }

    // ---- metadata endpoints ----------------------------------------------
    if (base === DRIVE_API_FILES_URL && method === 'GET') {
      return this.list(url.searchParams.get('q'));
    }
    if (base.startsWith(`${DRIVE_API_FILES_URL}/`)) {
      const id = decodeURIComponent(base.slice(DRIVE_API_FILES_URL.length + 1));
      const file = this.files.get(id);
      if (!file) return this.json(404, { error: { message: 'File not found' } });
      if (method === 'GET') {
        return url.searchParams.get('alt') === 'media'
          ? new Response(file.content, {
              status: 200,
              headers: { 'Content-Type': 'application/json', etag: file.etag },
            })
          : this.json(200, meta(file), file.etag);
      }
      if (method === 'PATCH') {
        const patch = JSON.parse(String(init?.body ?? '{}')) as {
          appProperties?: Record<string, string>;
        };
        if (patch.appProperties) file.appProperties = { ...patch.appProperties };
        return this.json(200, { appProperties: file.appProperties }, file.etag);
      }
      if (method === 'DELETE') {
        this.files.delete(id);
        return new Response(null, { status: 204 });
      }
    }

    return this.json(400, { error: { message: `Unhandled ${method} ${base}` } });
  }) as typeof fetch;

  private create(body: string): Response {
    const parts = parseMultipart(body);
    const metadata = JSON.parse(parts[0] ?? '{}') as {
      name?: string;
      appProperties?: Record<string, string>;
    };
    const id = `file-${++this.idCounter}`;
    const file: FakeDriveFile = {
      id,
      name: metadata.name ?? 'unnamed',
      content: parts[1] ?? 'null',
      etag: this.nextEtag(),
      modifiedTime: this.nextTime(),
      appProperties: metadata.appProperties ?? {},
    };
    this.files.set(id, file);
    // Drive's multipart upload reply carries NO etag header — the omission
    // `drive.ts` compensates for with a follow-up `readFileMeta`. Reproduce it
    // rather than papering over it; that follow-up is load-bearing.
    return this.json(200, meta(file));
  }

  private updateContent(id: string, body: string, ifMatch: string | undefined): Response {
    const file = this.files.get(id);
    if (!file) return this.json(404, { error: { message: 'File not found' } });
    if (ifMatch && ifMatch !== file.etag) {
      return this.json(412, { error: { message: 'Precondition Failed' } });
    }
    file.content = body;
    file.etag = this.nextEtag();
    file.modifiedTime = this.nextTime();
    // Same missing-etag quirk as `create`.
    return this.json(200, meta(file));
  }

  private list(q: string | null): Response {
    const match = q?.match(/name = '(.*?)' and trashed = false/);
    const wanted = match?.[1];
    const files = [...this.files.values()]
      .filter((f) => wanted === undefined || f.name === wanted)
      .map(meta);
    return this.json(200, { files });
  }

  private json(status: number, body: unknown, etag?: string): Response {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (etag) headers.etag = etag;
    return new Response(JSON.stringify(body), { status, headers });
  }

  private nextEtag(): string {
    return `"etag-${++this.etagCounter}"`;
  }

  private nextTime(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
}

function meta(file: FakeDriveFile): Record<string, unknown> {
  return {
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime,
    appProperties: file.appProperties,
  };
}

function normalizeHeaders(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  new Headers(init).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Pull the body parts out of the `multipart/related` payload `createJsonFile`
 * builds: `[metadata, content]`, each the text after its own blank line.
 */
function parseMultipart(body: string): string[] {
  const delimiter = body.split('\r\n', 1)[0];
  if (!delimiter) return [];
  return body
    .split(delimiter)
    .map((part) => {
      const at = part.indexOf('\r\n\r\n');
      return at === -1 ? '' : part.slice(at + 4).replace(/\r\n$/, '');
    })
    .filter((part) => part.length > 0);
}
