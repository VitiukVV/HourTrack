import type { Page } from '@playwright/test';

/**
 * Wait until the app's Dexie database is fully initialised at the current
 * schema version BEFORE a spec seeds into it.
 *
 * Why this needs care (and is NOT just `contains('settings')`):
 *
 * Calling `indexedDB.open('hourtrack')` WITHOUT a version on a database that
 * does not exist yet CREATES an empty version-1 database with ZERO object
 * stores (there is no `onupgradeneeded` handler to define them). If a test's
 * readiness probe does that before the app's Dexie singleton (`initDB` in
 * `main.tsx`) has run, Dexie then opens at v6 and upgrades FROM that bogus v1
 * — and the v5 DESTRUCTIVE migration (`tx.table('entries').clear()`) throws on
 * the missing store, aborting Dexie's open and leaving the DB half-built:
 * `settings` exists but `authTokens` does not. Every later `seedAuthedSession`
 * then dies with `NotFoundError: ... one of the specified object stores was
 * not found`. (S23's route lazy-loading shifted boot timing enough to make
 * this race fire on essentially every run.)
 *
 * The robust gate:
 *   1. If `upgradeneeded` fires, ABORT it — the DB is not ready yet; let the
 *      app's Dexie create it cleanly rather than leaving a store-less shell.
 *   2. Report ready only once BOTH the `settings` and `authTokens` stores
 *      exist AND `initDB` has seeded the singleton `settings` row.
 */
export async function waitForAppDb(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        let upgrading = false;
        const req = indexedDB.open('hourtrack'); // no version — join, never bump
        req.onupgradeneeded = (event) => {
          // DB absent / mid-upgrade → the app's Dexie hasn't finished. Roll
          // back so we don't leave a store-less shell that breaks Dexie's
          // own (destructive) v5 upgrade.
          upgrading = true;
          (event.target as IDBOpenDBRequest).transaction?.abort();
        };
        req.onsuccess = () => {
          const db = req.result;
          const storesReady =
            !upgrading &&
            db.objectStoreNames.contains('settings') &&
            db.objectStoreNames.contains('authTokens');
          if (!storesReady) {
            db.close();
            resolve(false);
            return;
          }
          // initDB seeds exactly one `settings` row keyed 'current'. Its
          // presence proves Dexie opened at v6 AND the boot init ran.
          const tx = db.transaction('settings', 'readonly');
          const getReq = tx.objectStore('settings').get('current');
          getReq.onsuccess = () => {
            db.close();
            resolve(Boolean(getReq.result));
          };
          getReq.onerror = () => {
            db.close();
            resolve(false);
          };
        };
        // Aborting the upgrade above surfaces here as an AbortError — treat as
        // "not ready yet" and let waitForFunction poll again.
        req.onerror = () => resolve(false);
        req.onblocked = () => resolve(false);
      }),
    null,
    { timeout: 15_000 },
  );
}
