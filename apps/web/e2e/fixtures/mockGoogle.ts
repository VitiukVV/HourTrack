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
  /** ETag returned alongside the existing file (and on writes). */
  etag?: string;
}

/**
 * Intercept the Drive REST endpoints HourTrack uses. The implementation
 * is in-memory so the test can do create → read → update → list against
 * a coherent state machine.
 */
export async function mockDriveApis(page: Page, opts: MockDriveOptions = {}): Promise<void> {
  let dataFile: { id: string; etag: string; body: unknown } | null = opts.existingFile
    ? { id: 'file-mock', etag: opts.etag ?? '"etag-1"', body: opts.existingFile }
    : null;
  const backups = new Map<string, { id: string; body: unknown; createdTime: string }>();

  // List files — used by findFile + listFiles
  await page.route(`${DRIVE_BASE}/files**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === 'GET') {
      // Single-file metadata (`/files/<id>?fields=...&alt=...`) vs list (`/files?q=...`)
      const pathMatch = url.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
      if (pathMatch) {
        const id = pathMatch[1]!;
        if (url.searchParams.get('alt') === 'media') {
          // Body read
          if (dataFile && dataFile.id === id) {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { etag: dataFile.etag },
              body: JSON.stringify(dataFile.body),
            });
            return;
          }
          const backup = backups.get(id);
          if (backup) {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(backup.body),
            });
            return;
          }
          await route.fulfill({ status: 404, body: 'Not Found' });
          return;
        }
        // Metadata read — return etag in body for the ETag-fallback path.
        if (dataFile && dataFile.id === id) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { etag: dataFile.etag },
            body: JSON.stringify({
              id: dataFile.id,
              name: 'data.json',
              etag: dataFile.etag,
              appProperties: { schemaVersion: '1' },
            }),
          });
          return;
        }
        const backupMeta = backups.get(id);
        if (backupMeta) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: backupMeta.id,
              name: `backups/${backupMeta.id}.json`,
              modifiedTime: backupMeta.createdTime,
              appProperties: { schemaVersion: '1' },
            }),
          });
          return;
        }
        await route.fulfill({ status: 404, body: 'Not Found' });
        return;
      }

      // List
      const q = url.searchParams.get('q') ?? '';
      const files: Array<Record<string, unknown>> = [];
      if (q.includes("name = 'data.json'") && dataFile) {
        files.push({
          id: dataFile.id,
          name: 'data.json',
          etag: dataFile.etag,
          appProperties: { schemaVersion: '1' },
        });
      }
      for (const [id, b] of backups.entries()) {
        files.push({
          id,
          name: `backups/${id}.json`,
          createdTime: b.createdTime,
        });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ files }),
      });
      return;
    }

    if (method === 'DELETE') {
      const pathMatch = url.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
      if (pathMatch) {
        const id = pathMatch[1]!;
        if (dataFile && dataFile.id === id) dataFile = null;
        backups.delete(id);
        await route.fulfill({ status: 204, body: '' });
        return;
      }
    }

    await route.fulfill({ status: 404, body: 'Not Found' });
  });

  // Upload (create + update via multipart)
  await page.route(`${DRIVE_UPLOAD_BASE}/files**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const post = route.request().postData() ?? '';
    // Parse out the JSON snapshot from the multipart body.
    const jsonStart = post.indexOf('{');
    let body: unknown = {};
    try {
      body = JSON.parse(post.slice(jsonStart, post.lastIndexOf('}') + 1));
    } catch {
      /* parse failure tolerated; tests verify behavior not raw bytes */
    }

    const pathMatch = url.pathname.match(/\/upload\/drive\/v3\/files\/([^/]+)$/);
    const newEtag = `"etag-${Date.now()}"`;

    if (method === 'POST') {
      const id = `file-${Math.random().toString(36).slice(2, 10)}`;
      const isBackup =
        post.includes('backups/') ||
        (typeof body === 'object' && body !== null && 'schemaVersion' in (body as object));
      if (isBackup && post.includes('backups/')) {
        backups.set(id, { id, body, createdTime: new Date().toISOString() });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { etag: newEtag },
          body: JSON.stringify({ id, name: `backups/${id}.json`, etag: newEtag }),
        });
        return;
      }
      // data.json create
      dataFile = { id: 'file-mock', etag: newEtag, body };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { etag: newEtag },
        body: JSON.stringify({ id: 'file-mock', name: 'data.json', etag: newEtag }),
      });
      return;
    }

    if (method === 'PATCH' && pathMatch) {
      const id = pathMatch[1]!;
      if (dataFile && dataFile.id === id) {
        dataFile = { ...dataFile, etag: newEtag, body };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { etag: newEtag },
          body: JSON.stringify({ id, name: 'data.json', etag: newEtag }),
        });
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
