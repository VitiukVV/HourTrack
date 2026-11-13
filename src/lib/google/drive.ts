/**
 * Thin `fetch`-based Google Drive v3 REST client. Scope is restricted to
 * `auth/drive.appdata` — ALL operations target `spaces=appDataFolder`,
 * NEVER the user's full Drive.
 *
 * Authentication: every call takes the access token as a parameter (rather
 * than reading the token store directly) so consumers can pass a freshly
 * refreshed token. Centralizing token reads here would make this client a
 * heavy circular import target; keep it pure-function with explicit bearer.
 *
 * Error model:
 *   - 200/201/204 -> resolve normally
 *   - 401         -> throw `DriveAuthError`. Callers renew the token and
 *                    retry (`SyncManager`, `withFreshToken`), not this client.
 *   - 404         -> throw `DriveNotFoundError`.
 *   - other       -> throw `DriveApiError`.
 *   - fetch itself rejected (offline, DNS, CORS, the 30 s timeout) -> throw
 *                    `DriveNetworkError`, so callers can tell a transient
 *                    network failure from a bug (a `TypeError` in app code).
 *
 * Revisions (spec 016): Drive v3 has no file ETag, and a browser could not
 * read the `ETag` header anyway (it is not CORS-exposed), so change detection
 * rests on the per-file `version` from the metadata BODY. Every metadata
 * `fields` list asks for it. There is no compare-and-swap: callers compare
 * the version before writing (see `SyncManager.syncCycle`).
 */

export const DRIVE_API_FILES_URL = 'https://www.googleapis.com/drive/v3/files' as const;
export const DRIVE_API_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files' as const;

const APPDATA_SPACE = 'appDataFolder' as const;
const META_FIELDS = 'id,name,modifiedTime,appProperties,version';

/** A file metadata row as returned by Drive's `files.list` / `files.get`. */
export interface DriveFileMeta {
  id: string;
  name: string;
  /**
   * Drive's file `version` (a decimal string) — changes on every content or
   * metadata modification. `''` when Drive did not return it.
   */
  version: string;
  /** Drive's modified time (ISO). */
  modifiedTime?: string;
  /** App-defined properties echoed back on read. */
  appProperties?: Record<string, string>;
}

/** Result of downloading a JSON file's contents. */
export interface DriveJsonContent<T = unknown> {
  data: T;
  fileId: string;
}

/** Result of creating or replacing a JSON file. */
export interface DriveJsonFile<T = unknown> {
  data: T;
  /** The file's `version` after the write (one request, one version). */
  version: string;
  fileId: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
}

export class DriveApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: string,
  ) {
    super(`Drive API error ${status} ${statusText}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.name = 'DriveApiError';
  }
}

export class DriveAuthError extends DriveApiError {
  constructor(body?: string) {
    super(401, 'Unauthorized', body);
    this.name = 'DriveAuthError';
  }
}

export class DriveNotFoundError extends DriveApiError {
  constructor(body?: string) {
    super(404, 'Not Found', body);
    this.name = 'DriveNotFoundError';
  }
}

/**
 * The request never got an HTTP answer: `fetch` rejected (offline, DNS,
 * CORS, the timeout below). Transient by nature. The original error is the
 * `cause`.
 */
export class DriveNetworkError extends Error {
  constructor(cause: unknown) {
    super(`Drive network error: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
    this.name = 'DriveNetworkError';
  }
}

interface DriveCallOptions {
  accessToken: string;
  fetchImpl?: typeof fetch;
}

/** Metadata as it arrives: Drive serialises `version` (int64) as a string. */
type RawFileMeta = Omit<DriveFileMeta, 'version'> & { version?: string | number };

function toMeta(raw: RawFileMeta): DriveFileMeta {
  return { ...raw, version: raw.version === undefined ? '' : String(raw.version) };
}

/**
 * S29 (UR-29-6): every Drive request is bounded by a 30s abort so a hung
 * connection can't freeze the SyncManager `flushInFlight` promise for the rest
 * of the session. An abort surfaces as a normal rejected fetch, which the
 * existing retry policy treats as a retryable failure. Callers that pass a
 * `fetchImpl` (tests) still get the timeout unless they supply their own
 * `signal`.
 */
const FETCH_TIMEOUT_MS = 30_000;

function withTimeout(fetchImpl: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await fetchImpl(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      throw new DriveNetworkError(err);
    }
  }) as typeof fetch;
}

function authHeader(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function rejectFromResponse(res: Response): Promise<never> {
  const body = await res.text().catch(() => '');
  if (res.status === 401) throw new DriveAuthError(body);
  if (res.status === 404) throw new DriveNotFoundError(body);
  throw new DriveApiError(res.status, res.statusText, body);
}

/**
 * Look up a single file in the appDataFolder by name. Returns `null` when
 * no file matches. Uses the `q` parameter with `name=` filter; `spaces` is
 * locked to `appDataFolder` so this can never leak to the user's drive.
 *
 * Older builds could create duplicates (two devices creating `data.json` at
 * once). `orderBy=createdTime` makes the pick stable — the OLDEST file — so
 * every device settles on the same one.
 */
export async function findFile(
  name: string,
  opts: DriveCallOptions,
): Promise<DriveFileMeta | null> {
  const fetchImpl = withTimeout(opts.fetchImpl);
  // Drive's q param needs single-quotes around the name; escape any embedded
  // single-quote to keep the query well-formed. App-controlled names should
  // never contain quotes but stay defensive.
  const safeName = name.replace(/'/g, "\\'");
  const url = new URL(DRIVE_API_FILES_URL);
  url.searchParams.set('spaces', APPDATA_SPACE);
  url.searchParams.set('q', `name = '${safeName}' and trashed = false`);
  url.searchParams.set('fields', `files(${META_FIELDS})`);
  url.searchParams.set('orderBy', 'createdTime');
  url.searchParams.set('pageSize', '10');

  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: authHeader(opts.accessToken),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  const body = (await res.json()) as { files?: RawFileMeta[] };
  const file = body.files?.[0];
  return file ? toMeta(file) : null;
}

/** Read a file's metadata, including its current `version`. */
export async function readFileMeta(fileId: string, opts: DriveCallOptions): Promise<DriveFileMeta> {
  const fetchImpl = withTimeout(opts.fetchImpl);
  const url = new URL(`${DRIVE_API_FILES_URL}/${encodeURIComponent(fileId)}`);
  url.searchParams.set('fields', META_FIELDS);
  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: authHeader(opts.accessToken),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  return toMeta((await res.json()) as RawFileMeta);
}

/**
 * Download + parse a JSON file by id. A media download carries no metadata;
 * read the `version` with `readFileMeta` first when it matters.
 */
export async function readJsonFile<T = unknown>(
  fileId: string,
  opts: DriveCallOptions,
): Promise<DriveJsonContent<T>> {
  const fetchImpl = withTimeout(opts.fetchImpl);
  const url = new URL(`${DRIVE_API_FILES_URL}/${encodeURIComponent(fileId)}`);
  url.searchParams.set('alt', 'media');
  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: authHeader(opts.accessToken),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch (err) {
    throw new DriveApiError(
      res.status,
      'JSON parse failed',
      err instanceof Error ? err.message : String(err),
    );
  }
  return { data, fileId };
}

/**
 * Create a new JSON file in the appDataFolder. Returns the resulting file
 * metadata (incl. `version`). Uses the simple `multipart` upload with the
 * metadata + raw JSON body in a single request — `appProperties` carry our
 * `schemaVersion` and `deviceId` markers.
 */
export async function createJsonFile<T>(
  name: string,
  data: T,
  appProperties: Record<string, string> | undefined,
  opts: DriveCallOptions,
): Promise<DriveJsonFile<T>> {
  const metadata = {
    name,
    parents: [APPDATA_SPACE],
    mimeType: 'application/json',
    appProperties: appProperties ?? {},
  };
  return multipartUpload('POST', DRIVE_API_UPLOAD_URL, metadata, data, opts);
}

/**
 * One `uploadType=multipart` request: a metadata part + the JSON media part.
 * Creates (POST) or replaces (PATCH) — one write, one Drive `version`.
 */
async function multipartUpload<T>(
  method: 'POST' | 'PATCH',
  endpoint: string,
  metadata: Record<string, unknown>,
  data: T,
  opts: DriveCallOptions,
): Promise<DriveJsonFile<T>> {
  const fetchImpl = withTimeout(opts.fetchImpl);
  const boundary = `--hourtrack-${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;
  const url = new URL(endpoint);
  url.searchParams.set('uploadType', 'multipart');
  url.searchParams.set('fields', META_FIELDS);
  const res = await fetchImpl(url.toString(), {
    method,
    headers: {
      ...authHeader(opts.accessToken),
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  const meta = toMeta((await res.json()) as RawFileMeta);
  return {
    data,
    version: meta.version,
    fileId: meta.id,
    modifiedTime: meta.modifiedTime,
    appProperties: meta.appProperties,
  };
}

/**
 * Replace a file's contents (and `appProperties`) with new JSON in ONE
 * request: `PATCH /upload/drive/v3/files/{id}?uploadType=multipart`, the
 * update twin of `createJsonFile`. One write means one `version`: with a
 * content upload followed by a separate metadata patch, another device
 * writing between the two would leave this device remembering a version it
 * never merged — and its next push would drop that device's rows.
 *
 * Unconditional: Drive offers no precondition a browser can use; the caller
 * compares the `version` beforehand.
 */
export async function updateJsonFile<T>(
  fileId: string,
  data: T,
  opts: DriveCallOptions & { appProperties?: Record<string, string> },
): Promise<DriveJsonFile<T>> {
  const metadata = opts.appProperties ? { appProperties: opts.appProperties } : {};
  const endpoint = `${DRIVE_API_UPLOAD_URL}/${encodeURIComponent(fileId)}`;
  const result = await multipartUpload('PATCH', endpoint, metadata, data, opts);
  return { ...result, fileId };
}

/**
 * Permanently delete a file from the appDataFolder. Idempotent on 404
 * (file already gone). Used by the S11 backup rotation.
 */
export async function deleteFile(fileId: string, opts: DriveCallOptions): Promise<void> {
  const fetchImpl = withTimeout(opts.fetchImpl);
  const url = new URL(`${DRIVE_API_FILES_URL}/${encodeURIComponent(fileId)}`);
  const res = await fetchImpl(url.toString(), {
    method: 'DELETE',
    headers: authHeader(opts.accessToken),
  });
  if (res.status === 404) return; // Idempotent.
  if (!res.ok) {
    return rejectFromResponse(res);
  }
}

/** List all files in the appDataFolder (backups + `data.json`). */
export async function listFiles(opts: DriveCallOptions): Promise<DriveFileMeta[]> {
  const fetchImpl = withTimeout(opts.fetchImpl);
  const url = new URL(DRIVE_API_FILES_URL);
  url.searchParams.set('spaces', APPDATA_SPACE);
  url.searchParams.set('fields', `files(${META_FIELDS})`);
  url.searchParams.set('pageSize', '1000');
  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: authHeader(opts.accessToken),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  const body = (await res.json()) as { files?: RawFileMeta[] };
  return (body.files ?? []).map(toMeta);
}
