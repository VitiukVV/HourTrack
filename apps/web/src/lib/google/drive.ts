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
 *   - 401         -> throw `DriveAuthError` (caller should trigger token
 *                    refresh + retry; see SyncManager). Token-refresh
 *                    handling lives in the SyncManager retry loop, not here.
 *   - 412         -> throw `DriveEtagMismatchError`. Caller pulls + merges
 *                    + retries.
 *   - 404         -> throw `DriveNotFoundError`.
 *   - other       -> throw `DriveApiError`.
 */

export const DRIVE_API_FILES_URL = 'https://www.googleapis.com/drive/v3/files' as const;
export const DRIVE_API_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files' as const;

const APPDATA_SPACE = 'appDataFolder' as const;

/** A file metadata row as returned by Drive's `files.list` / `files.get`. */
export interface DriveFileMeta {
  id: string;
  name: string;
  /** Drive's per-revision etag. Used as `If-Match` on the next update. */
  etag: string;
  /** Drive's modified time (ISO). */
  modifiedTime?: string;
  /** App-defined properties echoed back on read. */
  appProperties?: Record<string, string>;
}

/** Result of reading a JSON file from Drive. */
export interface DriveJsonFile<T = unknown> {
  data: T;
  etag: string;
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

export class DriveEtagMismatchError extends DriveApiError {
  constructor(body?: string) {
    super(412, 'Precondition Failed', body);
    this.name = 'DriveEtagMismatchError';
  }
}

export class DriveNotFoundError extends DriveApiError {
  constructor(body?: string) {
    super(404, 'Not Found', body);
    this.name = 'DriveNotFoundError';
  }
}

interface DriveCallOptions {
  accessToken: string;
  fetchImpl?: typeof fetch;
}

function authHeader(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function rejectFromResponse(res: Response): Promise<never> {
  const body = await res.text().catch(() => '');
  if (res.status === 401) throw new DriveAuthError(body);
  if (res.status === 404) throw new DriveNotFoundError(body);
  if (res.status === 412) throw new DriveEtagMismatchError(body);
  throw new DriveApiError(res.status, res.statusText, body);
}

/**
 * Look up a single file in the appDataFolder by name. Returns `null` when
 * no file matches. Uses the `q` parameter with `name=` filter; `spaces` is
 * locked to `appDataFolder` so this can never leak to the user's drive.
 */
export async function findFile(
  name: string,
  opts: DriveCallOptions,
): Promise<DriveFileMeta | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  // Drive's q param needs single-quotes around the name; escape any embedded
  // single-quote to keep the query well-formed. App-controlled names should
  // never contain quotes but stay defensive.
  const safeName = name.replace(/'/g, "\\'");
  const url = new URL(DRIVE_API_FILES_URL);
  url.searchParams.set('spaces', APPDATA_SPACE);
  url.searchParams.set('q', `name = '${safeName}' and trashed = false`);
  url.searchParams.set('fields', 'files(id,name,modifiedTime,appProperties)');
  url.searchParams.set('pageSize', '10');

  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: authHeader(opts.accessToken),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  const body = (await res.json()) as { files?: Array<Omit<DriveFileMeta, 'etag'>> };
  const file = body.files?.[0];
  if (!file) return null;
  // List endpoint doesn't return ETag — we fetch metadata to capture it. A
  // single extra round-trip is cheap and avoids a separate "warm-up read"
  // pattern in callers.
  return readFileMeta(file.id, opts);
}

/**
 * Read a file's metadata (incl. the ETag header). The ETag is the value
 * we'll send back as `If-Match` on the next update.
 */
export async function readFileMeta(fileId: string, opts: DriveCallOptions): Promise<DriveFileMeta> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`${DRIVE_API_FILES_URL}/${encodeURIComponent(fileId)}`);
  url.searchParams.set('fields', 'id,name,modifiedTime,appProperties');
  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: authHeader(opts.accessToken),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  const body = (await res.json()) as Omit<DriveFileMeta, 'etag'>;
  const etag = res.headers.get('etag') ?? '';
  return { ...body, etag };
}

/**
 * Read + parse a JSON file by id. Returns `{ data, etag, fileId }`. The
 * etag is captured from the response header for optimistic concurrency.
 */
export async function readJsonFile<T = unknown>(
  fileId: string,
  opts: DriveCallOptions,
): Promise<DriveJsonFile<T>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
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
  const etag = res.headers.get('etag') ?? '';
  // We don't have the modifiedTime here without an extra metadata call — most
  // callers only need data + etag. Metadata is available via `readFileMeta`.
  return { data, etag, fileId };
}

/**
 * Create a new JSON file in the appDataFolder. Returns the resulting file
 * metadata (incl. etag). Uses the simple `multipart` upload with the
 * metadata + raw JSON body in a single request — `appProperties` carry our
 * `schemaVersion` and `deviceId` markers.
 */
export async function createJsonFile<T>(
  name: string,
  data: T,
  appProperties: Record<string, string> | undefined,
  opts: DriveCallOptions,
): Promise<DriveJsonFile<T>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const boundary = `--hourtrack-${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name,
    parents: [APPDATA_SPACE],
    mimeType: 'application/json',
    appProperties: appProperties ?? {},
  };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;
  const url = new URL(DRIVE_API_UPLOAD_URL);
  url.searchParams.set('uploadType', 'multipart');
  url.searchParams.set('fields', 'id,name,modifiedTime,appProperties');
  const res = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: {
      ...authHeader(opts.accessToken),
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  const meta = (await res.json()) as Omit<DriveFileMeta, 'etag'>;
  const etag = res.headers.get('etag') ?? '';
  return {
    data,
    etag,
    fileId: meta.id,
    modifiedTime: meta.modifiedTime,
    appProperties: meta.appProperties,
  };
}

/**
 * Replace a file's contents with new JSON. Sends `If-Match: <etag>` so the
 * write fails with 412 if another device updated the file in the meantime
 * — that's the conflict-detection signal SyncManager waits for.
 *
 * Per Drive API quirks: updating just the *content* uses the `/upload/`
 * endpoint with `uploadType=media` and PATCH. App properties are NOT
 * preserved automatically on content-only updates, so we do a second
 * metadata PATCH if `appProperties` is provided.
 */
export async function updateJsonFile<T>(
  fileId: string,
  data: T,
  ifMatchEtag: string | null,
  opts: DriveCallOptions & { appProperties?: Record<string, string> },
): Promise<DriveJsonFile<T>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`${DRIVE_API_UPLOAD_URL}/${encodeURIComponent(fileId)}`);
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('fields', 'id,name,modifiedTime');
  const headers: Record<string, string> = {
    ...authHeader(opts.accessToken),
    'Content-Type': 'application/json',
  };
  if (ifMatchEtag) {
    headers['If-Match'] = ifMatchEtag;
  }
  const res = await fetchImpl(url.toString(), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  const meta = (await res.json()) as Omit<DriveFileMeta, 'etag'>;
  const etag = res.headers.get('etag') ?? '';

  // If appProperties are provided, sync them in a second metadata-only call.
  // Drive's `uploadType=media` path doesn't accept appProperties — that's
  // the documented quirk.
  let finalAppProperties: Record<string, string> | undefined;
  if (opts.appProperties) {
    finalAppProperties = await patchAppProperties(fileId, opts.appProperties, opts);
  }
  return { data, etag, fileId, modifiedTime: meta.modifiedTime, appProperties: finalAppProperties };
}

async function patchAppProperties(
  fileId: string,
  appProperties: Record<string, string>,
  opts: DriveCallOptions,
): Promise<Record<string, string>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`${DRIVE_API_FILES_URL}/${encodeURIComponent(fileId)}`);
  url.searchParams.set('fields', 'appProperties');
  const res = await fetchImpl(url.toString(), {
    method: 'PATCH',
    headers: {
      ...authHeader(opts.accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ appProperties }),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  const body = (await res.json()) as { appProperties?: Record<string, string> };
  return body.appProperties ?? {};
}

/**
 * Permanently delete a file from the appDataFolder. Idempotent on 404
 * (file already gone). Used by the S11 backup rotation.
 */
export async function deleteFile(fileId: string, opts: DriveCallOptions): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
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

/**
 * List all files in the appDataFolder. `parent` is accepted for future S11
 * use (snapshot subfolders) but currently always resolves under
 * appDataFolder.
 */
export async function listFiles(opts: DriveCallOptions): Promise<DriveFileMeta[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(DRIVE_API_FILES_URL);
  url.searchParams.set('spaces', APPDATA_SPACE);
  url.searchParams.set('fields', 'files(id,name,modifiedTime,appProperties)');
  url.searchParams.set('pageSize', '1000');
  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: authHeader(opts.accessToken),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  const body = (await res.json()) as { files?: Array<Omit<DriveFileMeta, 'etag'>> };
  // We don't fetch per-file etags here — listing is cheap, batched etag
  // fetch isn't supported by Drive v3 anyway. Callers that need the etag
  // call `readFileMeta(id)` afterwards.
  return (body.files ?? []).map((f) => ({ ...f, etag: '' }));
}
