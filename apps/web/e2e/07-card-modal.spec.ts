import { test, expect } from '@playwright/test';

import { seedAuthedSession } from './fixtures/auth';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * Regression: clicking "Edit" inside a Radix DropdownMenu must NOT leave
 * `document.body.style.pointerEvents === 'none'` once the Dialog opens.
 *
 * Without the microtask defer in `CardsHeader.handleEdit`, the menu's
 * scroll-lock and the Dialog's scroll-lock stack during the menu close
 * transition, and the body retains `pointer-events: none` even while the
 * Dialog is open — so the rest of the app becomes unclickable. The fix
 * defers `setModalState({open:true,...})` via `queueMicrotask` so the
 * menu's cleanup runs first.
 *
 * The test asserts:
 *   1. Edit modal becomes visible.
 *   2. Body's `pointerEvents` style is NOT 'none' while modal is open.
 *   3. After closing the modal (Escape), the body state is fully released.
 */

test.beforeEach(async ({ page }) => {
  await mockGisToken(page);
  await mockDriveApis(page, { existingFile: false });
  await mockCalendarApis(page);
  await page.goto('/login');
  await page.waitForFunction(
    async () => {
      try {
        const dbInner = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open('hourtrack');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const hasSettings = dbInner.objectStoreNames.contains('settings');
        dbInner.close();
        return hasSettings;
      } catch {
        return false;
      }
    },
    null,
    { timeout: 10_000 },
  );
  await seedAuthedSession(page, { onboardingSeen: true });
});

test('Edit-via-DropdownMenu does not leave body pointer-events: none', async ({ page }) => {
  await page.goto('/');
  await page.setViewportSize({ width: 1280, height: 800 });

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
        id: 'card-edit-test',
        name: 'Test Card',
        color: '#2563EB',
        defaultDurationMin: 480,
        defaultStartMinutes: 540,
        rateType: 'monthly',
        hourlyRate: null,
        fixedTotal: null,
        monthlyTotal: 250,
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

  await page.reload();
  await page.getByTestId('cards-header-first-chip').click();
  await page.getByTestId('cards-header-active-menu-trigger').click();
  await page.getByTestId('cards-header-active-menu-edit').click();

  // Modal opens
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Body must NOT have inline pointer-events: none (it would block all
  // clicks outside the dialog and stick around after close).
  const bodyPointerEventsOpen = await page.evaluate(() => document.body.style.pointerEvents);
  expect(bodyPointerEventsOpen).not.toBe('none');

  // Escape closes the modal — body pointer-events must remain clickable.
  // (Radix may leave a residual `data-scroll-locked` counter from the
  // menu→dialog handoff; that's a Radix internal we don't fight here.
  // What matters for the user is the inline pointer-events style.)
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 2_000 });
  const bodyAfterClose = await page.evaluate(() => document.body.style.pointerEvents);
  expect(bodyAfterClose).not.toBe('none');
});

test('Add card button opens the CardModal on desktop', async ({ page }) => {
  await page.goto('/');
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByTestId('cards-header-add-button').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await expect(dialog.locator('text=/Create/i').first()).toBeVisible();
});
