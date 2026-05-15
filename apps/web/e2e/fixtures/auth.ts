import type { Page } from '@playwright/test';

/**
 * Seed an authed Google session directly into IndexedDB.
 *
 * Each Playwright test runs in a fresh browser context with empty
 * storage, so we do NOT need to wipe IndexedDB between tests. The
 * helper just writes our synthetic `authTokens` row + a Settings row
 * carrying `firstLoginAt` / `onboardingSeen` flags.
 *
 * Calling order in a spec:
 *   1. mock the Google routes (mockGisToken, mockDriveApis, ...)
 *   2. `await page.goto('/login')` — gives Dexie a chance to open and
 *      create all v4 stores via its `version(4).stores(...)` declarations.
 *   3. `await seedAuthedSession(page, { ... })` — writes our authed
 *      tokens row + settings row into the already-existing stores.
 *   4. `await page.goto('/')` (or wherever the test wants to land).
 *
 * The scope string mirrors the production `config.ts` request — Drive
 * appdata + Calendar app-created — so the bootstrap's defensive scope
 * check passes.
 */

export interface SeedAuthOptions {
  scope?: string;
  email?: string;
  name?: string;
  /** Stamp `Settings.firstLoginAt` so onboarding gating fires (or doesn't). */
  firstLoginAt?: string | null;
  /** Pre-mark the tour as seen. Default: false (tour will activate). */
  onboardingSeen?: boolean;
}

export async function seedAuthedSession(page: Page, opts: SeedAuthOptions = {}): Promise<void> {
  const scope =
    opts.scope ??
    'openid email profile https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/calendar.app.created';
  const email = opts.email ?? 'tester@example.com';
  const name = opts.name ?? 'E2E Tester';
  const firstLoginAt =
    opts.firstLoginAt === undefined ? new Date().toISOString() : opts.firstLoginAt;
  const onboardingSeen = opts.onboardingSeen ?? false;

  // Run inside the page so IndexedDB belongs to the same origin. We open
  // WITHOUT specifying a version — the database already exists at version
  // 4 (Dexie opened it when AppRouter mounted), so omitting the version
  // lets us join without triggering an upgrade.
  await page.evaluate(
    async ({ scope, email, name, firstLoginAt, onboardingSeen }) => {
      const open = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('hourtrack');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const dbInner = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = dbInner.transaction(['authTokens', 'settings'], 'readwrite');
        tx.objectStore('authTokens').put({
          key: 'current',
          accessToken: 'AT-mock',
          accessTokenExpiresAt: Date.now() + 3_600_000,
          refreshToken: 'rt-mock',
          idToken: null,
          scope,
          email,
          name,
          picture: null,
        });
        // Merge into any existing settings row that initDB seeded.
        const settingsStore = tx.objectStore('settings');
        const getReq = settingsStore.get('current');
        getReq.onsuccess = () => {
          const existing = (getReq.result ?? {}) as Record<string, unknown>;
          settingsStore.put({
            key: 'current',
            language: 'en',
            theme: 'system',
            defaultView: 'month',
            hourtrackCalendarId: null,
            autoBackupEnabled: false,
            autoBackupIntervalDays: 3,
            lastBackupAt: null,
            lastSyncAt: null,
            deviceId: null,
            driveDataFileId: null,
            driveDataEtag: null,
            ...existing,
            // Always override these — tests need deterministic values.
            firstLoginAt,
            onboardingSeen,
          });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      dbInner.close();
    },
    { scope, email, name, firstLoginAt, onboardingSeen },
  );
}
