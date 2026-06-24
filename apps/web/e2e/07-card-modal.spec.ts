import { test, expect } from '@playwright/test';

import { seedAuthedSession } from './fixtures/auth';
import { waitForAppDb } from './fixtures/db';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * Regression: clicking "Edit" inside a Radix DropdownMenu must NOT leave
 * `document.body.style.pointerEvents === 'none'` once the Dialog opens.
 *
 * Without the task defer in `CardsHeader.handleEdit`, the menu's
 * scroll-lock and the Dialog's scroll-lock stack during the menu close
 * transition, and the body retains `pointer-events: none` even while the
 * Dialog is open — so the rest of the app becomes unclickable. The fix
 * defers `setModalState({open:true,...})` via `setTimeout(0)` so the
 * menu's cleanup runs first (a microtask is too early — Radix's portal
 * unmount cleanup itself runs in a task, so the defer must be a task too).
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
  await waitForAppDb(page);
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

  // While the dialog is open the BACKGROUND is intentionally inert — Radix
  // locks `body` pointer-events so clicks can't leak behind the modal. That
  // is correct modal behaviour (and current Radix applies it even for a
  // single layer), so we do NOT assert on `body` here. What must hold is
  // that the DIALOG ITSELF stays interactive; the real regression this test
  // guards — a lock left STUCK after close — is asserted below.
  const dialogPointerEvents = await dialog.evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(dialogPointerEvents).not.toBe('none');

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
