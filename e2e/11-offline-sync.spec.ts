import { test, expect, type Page } from '@playwright/test';

import { seedAuthedSession } from './fixtures/auth';
import { waitForAppDb } from './fixtures/db';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * S31 Task 12 (UR-31-7) — offline queue-drain. The offline-first PWA's central
 * promise had no e2e. This drives the REAL flow end-to-end:
 *
 *   - A mutation performed OFFLINE does not apply or sync immediately — the app
 *     (TanStack Query, default `networkMode: 'online'`) defers it while
 *     `navigator.onLine` is false, and the SyncManager's flush gate returns
 *     early rather than getting stuck "syncing".
 *   - On RECONNECT the deferred mutation applies (writes to Dexie) and the
 *     SyncManager drains its push queue back to empty (returns to idle).
 *
 * We assert the deferral (offline: no local write, empty queue) and the
 * reconnect convergence (the change landed locally AND the sync queue drained).
 */

test.beforeEach(async ({ page }) => {
  await mockGisToken(page);
  await mockDriveApis(page, { existingFile: false });
  await mockCalendarApis(page);
  await page.goto('/login');
  await waitForAppDb(page);
  await seedAuthedSession(page, { onboardingSeen: true });
});

/** Count rows currently in the Dexie `syncQueue` store (-1 if store absent). */
async function syncQueueCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('hourtrack');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('syncQueue')) {
            db.close();
            resolve(-1);
            return;
          }
          const tx = db.transaction('syncQueue', 'readonly');
          const countReq = tx.objectStore('syncQueue').count();
          countReq.onsuccess = () => {
            db.close();
            resolve(countReq.result);
          };
          countReq.onerror = () => {
            db.close();
            resolve(-1);
          };
        };
        req.onerror = () => resolve(-1);
      }),
  );
}

/** Read the persisted `Settings.theme` from Dexie. */
async function persistedTheme(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('hourtrack');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('settings', 'readonly');
          const s = tx.objectStore('settings').get('current');
          s.onsuccess = () => {
            db.close();
            resolve((s.result as { theme?: unknown })?.theme);
          };
          s.onerror = () => {
            db.close();
            resolve(undefined);
          };
        };
        req.onerror = () => resolve(undefined);
      }),
  );
}

test('an offline mutation is deferred, then applies and drains the sync queue on reconnect', async ({
  page,
  context,
}) => {
  await page.goto('/settings');
  await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 10_000 });

  // Bootstrap settles: data.json created, no push enqueued → queue empty, and
  // the default theme has not been changed.
  await expect.poll(() => syncQueueCount(page), { timeout: 15_000 }).toBe(0);
  expect(await persistedTheme(page)).toBe('system');

  // Go OFFLINE.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);

  // Mutate offline: switch theme to dark. The mutation is DEFERRED (not applied
  // to Dexie, nothing pushed) while offline — the queue stays empty and the
  // sync layer is not wedged "syncing".
  await page.locator('[data-testid="settings-interface-theme"] [data-value="dark"]').click();
  await page.waitForTimeout(1_000);
  expect(await persistedTheme(page)).toBe('system'); // deferred, not yet applied
  expect(await syncQueueCount(page)).toBe(0);

  // RECONNECT → the deferred mutation resumes: it applies locally (theme=dark)
  // and its push enqueues + drains back to an empty queue.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect.poll(() => persistedTheme(page), { timeout: 15_000 }).toBe('dark');
  await expect.poll(() => syncQueueCount(page), { timeout: 15_000 }).toBe(0);
});
