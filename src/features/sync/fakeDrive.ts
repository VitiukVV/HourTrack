import { DRIVE_API_FILES_URL, DRIVE_API_UPLOAD_URL } from '@/lib/google/drive';

/**
 * An in-memory stand-in for the Drive appDataFolder, exposed as a `fetch`.
 *
 * `lib/google/drive.ts` takes a `fetchImpl` on every call, so a fake at that
 * seam exercises the REAL request building, `fields` lists, multipart upload
 * and error mapping — everything a hand-written response stub skips.
 *
 * It behaves like Drive v3 as a BROWSER sees it (spec 016, MR-002):
 *   - no `etag` response header (Drive v3 has no file etag and does not
 *     expose the header to CORS callers), and `If-Match` is ignored;
 *   - a per-file `version` (decimal string) bumped ONCE per write — a
 *     multipart (metadata + content) upload, a media-only upload, an
 *     out-of-band write and a metadata-only PATCH each count as one;
 *   - metadata replies carry only the fields named in `fields`, so a request
 *     that forgets `version` really gets no `version`;
 *   - `files.list` rejects a `q` it cannot parse (400) and, without
 *     `orderBy`, promises no order (here: newest first);
 *     `orderBy=createdTime` returns the oldest first.
 *
 * File contents are stored as JSON TEXT, so two "devices" pointed at one
 * FakeDrive can never share an object graph — a merge bug that mutates its
 * input in place shows up instead of being masked.
 *
 * Nothing here is imported by app code; it exists for
 * `syncEngine.e2e.test.ts` and any future conflict regression.
 */

interface FakeDriveFile {
  id: string;
  name: string;
  /** Raw JSON text — see the round-trip note above. */
  content: string;
  version: number;
  createdTime: string;
  modifiedTime: string;
  appProperties: Record<string, string>;
}

export interface FakeDriveOptions {
  /** Access tokens the server should reject with 401. */
  revokedTokens?: Set<string>;
  /** Never return `version` in metadata — a Drive reply without it must fail safe. */
  omitVersion?: boolean;
}

/** Runs before an upload is applied — lets a test interleave another device. */
type UploadHook = () => Promise<void> | void;

/** Drive v3's reply when `fields` is not given. */
const DEFAULT_FIELDS = ['id', 'name', 'mimeType'];

export class FakeDrive {
  private readonly files = new Map<string, FakeDriveFile>();
  private idCounter = 0;
  private clock = Date.parse('2026-01-01T00:00:00.000Z');
  private offline = false;
  private readonly revokedTokens: Set<string>;
  private readonly omitVersion: boolean;
  private readonly uploadHooks = new Map<string, UploadHook>();

  /** Call counters — used to assert that pushes coalesce rather than pile up. */
  reads = 0;
  writes = 0;
  /** `alt=media` downloads only — SC-003 asserts none happen on an unchanged remote. */
  mediaReads = 0;

  constructor(options: FakeDriveOptions = {}) {
    this.revokedTokens = options.revokedTokens ?? new Set();
    this.omitVersion = options.omitVersion ?? false;
  }

  /**
   * Run `hook` once, right before the next content upload made with `token`
   * is applied — after that device's version check. Simulates another device
   * writing inside the check → upload window (the accepted race).
   */
  beforeNextUpload(token: string, hook: UploadHook): void {
    this.uploadHooks.set(token, hook);
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

  /** The id of the first file named `name` (`null` when none). */
  idOf(name: string): string | null {
    for (const file of this.files.values()) {
      if (file.name === name) return file.id;
    }
    return null;
  }

  /** The stored `version` of the first file named `name` (`null` when none). */
  versionOf(name: string): string | null {
    for (const file of this.files.values()) {
      if (file.name === name) return String(file.version);
    }
    return null;
  }

  /** Create ANOTHER file named `name` out-of-band (an older build's duplicate). */
  addDuplicate(name: string, data: unknown): void {
    const id = `file-${++this.idCounter}`;
    const now = this.nextTime();
    this.files.set(id, {
      id,
      name,
      content: JSON.stringify(data),
      version: 1,
      createdTime: now,
      modifiedTime: now,
      appProperties: {},
    });
  }

  /** How many files carry `name` — a duplicate `data.json` is a sync bug. */
  count(name: string): number {
    return [...this.files.values()].filter((f) => f.name === name).length;
  }

  /** Delete every file named `name` out-of-band (removed on Google's side). */
  remove(name: string): void {
    for (const [id, file] of this.files) {
      if (file.name === name) this.files.delete(id);
    }
  }

  /** Overwrite a file's contents out-of-band (simulates a third device). */
  write(name: string, data: unknown): void {
    for (const file of this.files.values()) {
      if (file.name === name) {
        file.content = JSON.stringify(data);
        this.touch(file);
        return;
      }
    }
    this.addDuplicate(name, data);
  }

  /** The `fetchImpl` to hand to `SyncManager` / `drive.ts`. */
  readonly fetchImpl: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = normalizeHeaders(init?.headers);
    const fields = url.searchParams.get('fields');

    const auth = headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (!token || this.revokedTokens.has(token)) {
      return json(401, { error: { message: 'Invalid Credentials' } });
    }

    if (method === 'GET') this.reads += 1;
    else this.writes += 1;

    const base = `${url.origin}${url.pathname}`;

    // ---- upload endpoints ------------------------------------------------
    if (base === DRIVE_API_UPLOAD_URL && method === 'POST') {
      return this.create(String(init?.body ?? ''), fields);
    }
    if (base.startsWith(`${DRIVE_API_UPLOAD_URL}/`) && method === 'PATCH') {
      const hook = this.uploadHooks.get(token);
      if (hook) {
        this.uploadHooks.delete(token);
        await hook();
      }
      const id = decodeURIComponent(base.slice(DRIVE_API_UPLOAD_URL.length + 1));
      const file = this.files.get(id);
      if (!file) return json(404, { error: { message: 'File not found' } });
      const body = String(init?.body ?? '');
      const uploadType = url.searchParams.get('uploadType');
      if (uploadType === 'multipart') {
        // Metadata + content in one request: ONE write, ONE version bump.
        const parts = parseMultipart(body);
        const metadata = JSON.parse(parts[0] ?? '{}') as {
          appProperties?: Record<string, string>;
        };
        if (metadata.appProperties) file.appProperties = { ...metadata.appProperties };
        file.content = parts[1] ?? 'null';
      } else if (uploadType === 'media') {
        file.content = body;
      } else {
        return json(400, { error: { message: `Unsupported uploadType ${uploadType}` } });
      }
      this.touch(file);
      return json(200, this.pick(file, fields));
    }

    // ---- metadata endpoints ----------------------------------------------
    if (base === DRIVE_API_FILES_URL && method === 'GET') {
      return this.list(url.searchParams.get('q'), url.searchParams.get('orderBy'), fields);
    }
    if (base.startsWith(`${DRIVE_API_FILES_URL}/`)) {
      const id = decodeURIComponent(base.slice(DRIVE_API_FILES_URL.length + 1));
      const file = this.files.get(id);
      if (!file) return json(404, { error: { message: 'File not found' } });
      if (method === 'GET') {
        if (url.searchParams.get('alt') === 'media') {
          this.mediaReads += 1;
          return new Response(file.content, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return json(200, this.pick(file, fields));
      }
      if (method === 'PATCH') {
        const patch = JSON.parse(String(init?.body ?? '{}')) as {
          appProperties?: Record<string, string>;
        };
        if (patch.appProperties) file.appProperties = { ...patch.appProperties };
        // A metadata change is a modification too: Drive bumps `version`.
        this.touch(file);
        return json(200, this.pick(file, fields));
      }
      if (method === 'DELETE') {
        this.files.delete(id);
        return new Response(null, { status: 204 });
      }
    }

    return json(400, { error: { message: `Unhandled ${method} ${base}` } });
  }) as typeof fetch;

  private create(body: string, fields: string | null): Response {
    const parts = parseMultipart(body);
    const metadata = JSON.parse(parts[0] ?? '{}') as {
      name?: string;
      appProperties?: Record<string, string>;
    };
    const id = `file-${++this.idCounter}`;
    const now = this.nextTime();
    const file: FakeDriveFile = {
      id,
      name: metadata.name ?? 'unnamed',
      content: parts[1] ?? 'null',
      version: 1,
      createdTime: now,
      modifiedTime: now,
      appProperties: metadata.appProperties ?? {},
    };
    this.files.set(id, file);
    return json(200, this.pick(file, fields));
  }

  private list(q: string | null, orderBy: string | null, fields: string | null): Response {
    let wanted: string | undefined;
    if (q !== null) {
      // The only query the app sends; anything else is a malformed request.
      const match = q.match(/^name = '((?:[^'\\]|\\.)*)' and trashed = false$/);
      if (!match) return json(400, { error: { message: `Invalid Value: q=${q}` } });
      wanted = match[1]!.replace(/\\'/g, "'");
    }
    let files = [...this.files.values()].filter((f) => wanted === undefined || f.name === wanted);
    if (orderBy === 'createdTime') {
      files.sort((a, b) => a.createdTime.localeCompare(b.createdTime));
    } else if (orderBy === null) {
      files = files.reverse();
    } else {
      return json(400, { error: { message: `Invalid orderBy: ${orderBy}` } });
    }
    // `fields=files(a,b)` names the per-file fields.
    const inner = fields?.match(/^files\((.*)\)$/)?.[1] ?? null;
    return json(200, { files: files.map((f) => this.pick(f, inner)) });
  }

  /** `pick`, minus `version` when this Drive is set to omit it. */
  private pick(file: FakeDriveFile, fields: string | null): Record<string, unknown> {
    const out = pick(file, fields);
    if (this.omitVersion) delete out.version;
    return out;
  }

  private touch(file: FakeDriveFile): void {
    file.version += 1;
    file.modifiedTime = this.nextTime();
  }

  private nextTime(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The file's metadata, limited to the comma-separated `fields` list. */
function pick(file: FakeDriveFile, fields: string | null): Record<string, unknown> {
  const all: Record<string, unknown> = {
    id: file.id,
    name: file.name,
    mimeType: 'application/json',
    version: String(file.version),
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    appProperties: file.appProperties,
  };
  const wanted = fields ? fields.split(',').map((f) => f.trim()) : DEFAULT_FIELDS;
  const out: Record<string, unknown> = {};
  for (const key of wanted) {
    if (key in all) out[key] = all[key];
  }
  return out;
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
 * Pull the body parts out of the `multipart/related` payload `drive.ts`
 * builds for create (POST) and update (PATCH): `[metadata, content]`, each the text after its own blank line.
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
