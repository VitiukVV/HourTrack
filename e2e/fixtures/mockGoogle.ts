import type { Page, Route } from '@playwright/test';

/**
 * Network-layer mocks for Google APIs. The real OAuth dance never runs in
 * E2E — every endpoint Auth/Drive/Calendar hits is intercepted via
 * `page.route` with a canned JSON response.
 *
 * Routes registered here MUST be set up in `test.beforeEach` (before any
 * page navigation). Playwright clears routes between specs automatically.
 */

const GIS_TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Matches GOOGLE_USERINFO_ENDPOINT in src/lib/google/config.ts.
const GIS_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GIS_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

/** Build a minimal token response Google returns from the PKCE exchange. */
function tokenResponse(scope: string, accessToken: string): Record<string, unknown> {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: 'rt-mock',
    id_token: 'idt-mock',
    scope,
  };
}

export interface MockGisOptions {
  scope?: string;
  accessToken?: string;
  email?: string;
  name?: string;
  picture?: string | null;
}

export async function mockGisToken(page: Page, opts: MockGisOptions = {}): Promise<void> {
  const scope =
    opts.scope ??
    'openid email profile https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/calendar.app.created';
  const accessToken = opts.accessToken ?? 'AT-mock';
  const email = opts.email ?? 'tester@example.com';
  const name = opts.name ?? 'E2E Tester';
  const picture = opts.picture ?? null;

  await page.route(GIS_TOKEN_URL, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tokenResponse(scope, accessToken)),
    });
  });

  await page.route(`${GIS_USERINFO_URL}*`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sub: 'sub-1', email, name, picture }),
    });
  });

  await page.route(GIS_REVOKE_URL, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

export interface MockDriveOptions {
  /**
   * Initial state of `appDataFolder/data.json`. `undefined` = no file
   * yet (first run on this account); object = inline JSON the next read
   * will return.
   */
  existingFile?: unknown;
  /** Drive `version` of the existing file. Bumped on every write. */
  version?: number;
}

/**
 * Intercept the Drive REST endpoints HourTrack uses. The implementation
 * is in-memory so the test can do create → read → update → list against
 * a coherent state machine.
 *
 * Like real Drive v3 seen from a browser (spec 016): no `etag` response
 * header, `If-Match` ignored, a per-file `version` in metadata bodies bumped
 * ONCE per write (`updateJsonFile` sends content + `appProperties` as one
 * multipart PATCH), `fields` honoured on `data.json` metadata replies, and a
 * `name = '…'` query that only matches files with that name.
 */
export async function mockDriveApis(page: Page, opts: MockDriveOptions = {}): Promise<void> {
  let dataFile: {
    id: string;
    version: number;
    body: unknown;
    appProperties: Record<string, string>;
  } | null = opts.existingFile
    ? {
        id: 'file-mock',
        version: opts.version ?? 1,
        body: opts.existingFile,
        appProperties: { schemaVersion: '1' },
      }
    : null;
  const backups = new Map<string, { id: string; body: unknown; createdTime: string }>();

  /** `data.json` metadata, limited to `fields` (`files(a,b)` or `a,b`) when given. */
  const dataMeta = (file: NonNullable<typeof dataFile>, fields?: string | null) => {
    const all: Record<string, unknown> = {
      id: file.id,
      name: 'data.json',
      version: String(file.version),
      appProperties: file.appProperties,
    };
    const list = fields?.replace(/^files\((.*)\)$/, '$1');
    if (!list) return all;
    return Object.fromEntries(
      list
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f in all)
        .map((f) => [f, all[f]]),
    );
  };
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  // List files — used by findFile + listFiles
  await page.route(`${DRIVE_BASE}/files**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const pathMatch = url.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);

    if (method === 'GET') {
      // Single-file metadata (`/files/<id>?fields=...&alt=...`) vs list (`/files?q=...`)
      if (pathMatch) {
        const id = pathMatch[1]!;
        if (url.searchParams.get('alt') === 'media') {
          // Body read
          if (dataFile && dataFile.id === id) {
            await json(route, dataFile.body);
            return;
          }
          const backup = backups.get(id);
          if (backup) {
            await json(route, backup.body);
            return;
          }
          await route.fulfill({ status: 404, body: 'Not Found' });
          return;
        }
        // Metadata read — the `version` comes in the body.
        if (dataFile && dataFile.id === id) {
          await json(route, dataMeta(dataFile, url.searchParams.get('fields')));
          return;
        }
        const backupMeta = backups.get(id);
        if (backupMeta) {
          await json(route, {
            id: backupMeta.id,
            name: `backups/${backupMeta.id}.json`,
            version: '1',
            modifiedTime: backupMeta.createdTime,
            appProperties: { schemaVersion: '1' },
          });
          return;
        }
        await route.fulfill({ status: 404, body: 'Not Found' });
        return;
      }

      // List. `findFile` sends `q=name = '<name>' and trashed = false` (and
      // `orderBy=createdTime`, moot with one file per name): only files with
      // that name match. `listFiles` sends no `q` and gets the backups.
      const q = url.searchParams.get('q');
      const wanted = q?.match(/^name = '(.*)' and trashed = false$/)?.[1];
      const files: Array<Record<string, unknown>> = [];
      if (wanted === 'data.json' && dataFile) {
        files.push(dataMeta(dataFile, url.searchParams.get('fields')));
      }
      for (const [id, b] of backups.entries()) {
        if (q !== null && wanted !== `backups/${id}.json`) continue;
        files.push({
          id,
          name: `backups/${id}.json`,
          version: '1',
          createdTime: b.createdTime,
        });
      }
      await json(route, { files });
      return;
    }

    // Metadata-only PATCH — real Drive accepts it (one write, one version
    // bump); the app itself now sends `appProperties` with the upload.
    if (method === 'PATCH' && pathMatch && dataFile && dataFile.id === pathMatch[1]) {
      const patch = JSON.parse(route.request().postData() ?? '{}') as {
        appProperties?: Record<string, string>;
      };
      if (patch.appProperties) dataFile.appProperties = { ...patch.appProperties };
      dataFile.version += 1;
      await json(route, {
        appProperties: dataFile.appProperties,
        version: String(dataFile.version),
      });
      return;
    }

    if (method === 'DELETE' && pathMatch) {
      const id = pathMatch[1]!;
      if (dataFile && dataFile.id === id) dataFile = null;
      backups.delete(id);
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    await route.fulfill({ status: 404, body: 'Not Found' });
  });

  // Upload (create + update via multipart)
  await page.route(`${DRIVE_UPLOAD_BASE}/files**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const post = route.request().postData() ?? '';
    // Extract the metadata and the DATA snapshot from the request body.
    //   - `uploadType=multipart` (createJsonFile POST, updateJsonFile PATCH):
    //     two JSON parts — metadata then data — each preceded by a `\r\n\r\n`
    //     header separator. The DATA is the LAST part; the naive
    //     `firstBrace..lastBrace` slice would span the boundary between both
    //     parts and fail to parse (S31: this broke the restore round-trip,
    //     which reads the stored backup body back).
    //   - `uploadType=media` (no longer sent by the app): the body is raw JSON.
    let body: unknown = {};
    let metadata: { appProperties?: Record<string, string> } = {};
    try {
      const seps = [...post.matchAll(/\r\n\r\n/g)];
      if (seps.length >= 2) {
        const metaStart = seps[0]!.index + 4;
        metadata = JSON.parse(post.slice(metaStart, post.indexOf('\r\n--', metaStart))) as {
          appProperties?: Record<string, string>;
        };
        // Multipart: data follows the SECOND header separator.
        const dataStart = seps[1]!.index + 4;
        const dataEnd = post.indexOf('\r\n--', dataStart);
        body = JSON.parse(post.slice(dataStart, dataEnd === -1 ? undefined : dataEnd));
      } else {
        body = JSON.parse(post.slice(post.indexOf('{'), post.lastIndexOf('}') + 1));
      }
    } catch {
      /* parse failure tolerated; tests verify behavior not raw bytes */
    }
    const fields = url.searchParams.get('fields');

    const pathMatch = url.pathname.match(/\/upload\/drive\/v3\/files\/([^/]+)$/);

    if (method === 'POST') {
      const id = `file-${Math.random().toString(36).slice(2, 10)}`;
      if (post.includes('backups/')) {
        backups.set(id, { id, body, createdTime: new Date().toISOString() });
        await json(route, { id, name: `backups/${id}.json`, version: '1' });
        return;
      }
      // data.json create
      dataFile = { id: 'file-mock', version: 1, body, appProperties: metadata.appProperties ?? {} };
      await json(route, dataMeta(dataFile, fields));
      return;
    }

    if (method === 'PATCH' && pathMatch) {
      const id = pathMatch[1]!;
      if (dataFile && dataFile.id === id) {
        // Content + appProperties in one request: ONE version bump.
        dataFile = {
          ...dataFile,
          version: dataFile.version + 1,
          body,
          appProperties: metadata.appProperties
            ? { ...metadata.appProperties }
            : dataFile.appProperties,
        };
        await json(route, dataMeta(dataFile, fields));
        return;
      }
    }
    await route.fulfill({ status: 404, body: 'Not Found' });
  });
}

export interface MockCalendarOptions {
  calendarId?: string;
  calendarName?: string;
}

/**
 * Calendar API mock. The current E2E suite doesn't deeply exercise
 * calendar sync — `goldenPathDay` covers entry-create which enqueues a
 * createCalendarEvent op, but we only need the endpoint to resolve
 * happily so SyncManager can drain its queue.
 */
export async function mockCalendarApis(page: Page, opts: MockCalendarOptions = {}): Promise<void> {
  const calendarId = opts.calendarId ?? 'cal-mock@group.calendar.google.com';
  const calendarName = opts.calendarName ?? 'HourTrack';
  const events = new Map<string, Record<string, unknown>>();

  await page.route(`${CALENDAR_BASE}/users/me/calendarList**`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{ id: calendarId, summary: calendarName, accessRole: 'owner' }],
      }),
    });
  });

  await page.route(`${CALENDAR_BASE}/calendars**`, async (route: Route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const m = url.pathname.match(/\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (m) {
      const eventId = m[2];
      if (method === 'POST') {
        const id = `evt-${Math.random().toString(36).slice(2, 10)}`;
        const data = JSON.parse(route.request().postData() ?? '{}');
        events.set(id, { ...data, id });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id, ...data }),
        });
        return;
      }
      if (method === 'PATCH' && eventId) {
        const data = JSON.parse(route.request().postData() ?? '{}');
        const existing = events.get(eventId) ?? {};
        const merged = { ...existing, ...data, id: eventId };
        events.set(eventId, merged);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(merged),
        });
        return;
      }
      if (method === 'DELETE' && eventId) {
        events.delete(eventId);
        await route.fulfill({ status: 204, body: '' });
        return;
      }
    }
    // List events on a calendar.
    if (method === 'GET' && url.pathname.endsWith('/events')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: Array.from(events.values()) }),
      });
      return;
    }
    // Default OK for unexpected paths — avoid blocking the test on minor
    // surface we don't model.
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}
