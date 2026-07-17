import { test, expect, type Page } from '@playwright/test';

import { seedAuthedSession } from './fixtures/auth';
import { waitForAppDb } from './fixtures/db';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * Golden Path #4 — Backup + Restore flow.
 *
 * Covers:
 *   (a) Create backup from Settings emits a success toast.
 *   (b) Full RESTORE round-trip (S31 Task 10): seed → back up → mutate/delete
 *       locally → restore → local Dexie matches the backup exactly, and a
 *       pre-restore safety backup was uploaded first. The post-restore
 *       `window.location.reload()` is handled by polling IndexedDB across the
 *       navigation (`page.waitForFunction` survives reloads) — the mocked Drive
 *       routes + the seeded auth token persist across the reload, so bootstrap
 *       re-hydrates from the just-restored `data.json`.
 */

test.beforeEach(async ({ page }) => {
  await mockGisToken(page);
  await mockDriveApis(page, { existingFile: false });
  await mockCalendarApis(page);
  await page.goto('/login');
  await waitForAppDb(page);
  await seedAuthedSession(page, { onboardingSeen: true });
});

test('Create backup from Settings emits a success toast and refreshes the snapshots list', async ({
  page,
}) => {
  // Seed at least one card so the backup snapshot has content.
  await page.goto('/');
  await page.evaluate(async () => {
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('hourtrack');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['cards'], 'readwrite');
      tx.objectStore('cards').put({
        id: 'card-backup',
        name: 'BackupTarget',
        color: '#3B82F6',
        defaultDurationMin: 60,
        rateType: 'hourly',
        hourlyRate: 10,
        fixedTotal: null,
        monthlyTotal: null,
        defaultNote: null,
        isArchived: false,
        archivedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  await page.goto('/settings');
  await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 10_000 });

  // Click "Create backup now". Use a text match so the test survives an
  // i18n key rename — the visible copy is the contract.
  const createBackupBtn = page.getByRole('button', { name: /create backup now/i });
  await expect(createBackupBtn).toBeVisible();
  await createBackupBtn.click();

  // Sonner toast surfaces success. The toaster mounts top-right; we
  // look up the localized success message.
  await expect(page.getByText(/backup created/i)).toBeVisible({ timeout: 10_000 });
});

/** Write a single card into the app's IndexedDB `cards` store. */
async function putCard(page: Page, id: string, name: string) {
  await page.evaluate(
    async ({ id, name }) => {
      const open = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('hourtrack');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['cards'], 'readwrite');
        tx.objectStore('cards').put({
          id,
          name,
          color: '#3B82F6',
          defaultDurationMin: 60,
          defaultStartMinutes: 540,
          rateType: 'hourly',
          hourlyRate: 10,
          fixedTotal: null,
          monthlyTotal: null,
          defaultNote: null,
          isArchived: false,
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { id, name },
  );
}

/** Delete a card from the app's IndexedDB `cards` store. */
async function deleteCard(page: Page, id: string) {
  await page.evaluate(async (id) => {
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('hourtrack');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['cards'], 'readwrite');
      tx.objectStore('cards').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, id);
}

test('RESTORE round-trip: restoring a backup replaces local state with the backup exactly (S31 Task 10)', async ({
  page,
}) => {
  // Record the pre-restore safety-backup upload (name contains 'pre-restore').
  const preRestoreUploads: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/upload/drive/v3/files')) {
      const pd = req.postData() ?? '';
      if (pd.includes('pre-restore')) preRestoreUploads.push(req.url());
    }
  });

  // 1. Seed the ORIGINAL state, then back it up.
  await page.goto('/');
  await putCard(page, 'card-original', 'OriginalClient');

  await page.goto('/settings');
  await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /create backup now/i }).click();
  await expect(page.getByText(/backup created/i)).toBeVisible({ timeout: 10_000 });

  // 2. Mutate locally AFTER the backup: delete the backed-up card, add a new one.
  await deleteCard(page, 'card-original');
  await putCard(page, 'card-after-backup', 'ShouldVanish');

  // 3. Open the snapshots list and restore the backup.
  await page.getByTestId('settings-data-snapshots-toggle').click();
  const restoreBtn = page.locator('[data-testid^="settings-data-snapshot-restore-"]').first();
  await expect(restoreBtn).toBeVisible({ timeout: 10_000 });
  await restoreBtn.click();

  // Two-step destructive confirmation.
  await expect(page.getByTestId('restore-modal')).toBeVisible();
  await page.getByTestId('restore-modal-continue').click();
  await page.getByTestId('restore-modal-input').fill('RESTORE');
  await page.getByTestId('restore-modal-confirm').click();

  // 4. The pre-restore safety backup was uploaded before the wipe.
  await expect.poll(() => preRestoreUploads.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

  // 5. After the post-restore reload, local Dexie matches the backup EXACTLY:
  //    the original card is back and the post-backup mutation is gone.
  //    `waitForFunction` survives the `window.location.reload()`.
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open('hourtrack');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('cards')) {
            db.close();
            resolve(false);
            return;
          }
          const tx = db.transaction('cards', 'readonly');
          const all = tx.objectStore('cards').getAll();
          all.onsuccess = () => {
            const ids = (all.result as Array<{ id: string }>).map((c) => c.id);
            db.close();
            resolve(ids.includes('card-original') && !ids.includes('card-after-backup'));
          };
          all.onerror = () => {
            db.close();
            resolve(false);
          };
        };
        req.onerror = () => resolve(false);
      }),
    null,
    { timeout: 20_000 },
  );
});
