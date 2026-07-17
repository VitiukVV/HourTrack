import { test, expect, type Page } from '@playwright/test';

import { seedAuthedSession } from './fixtures/auth';
import { waitForAppDb } from './fixtures/db';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * Golden Path #9 — Monthly payment tracking (S27).
 *
 * Seeds a monthly retainer card ("Марі 250") with an entry in the current
 * month, opens /payments, and drives the mark-paid / partial / undo flows.
 * The default period is the current month, so the seeded entry lands in view
 * without any month navigation.
 *
 * Runs under both `chromium` and `mobile-iphone-13` projects (playwright.config
 * defines both) — the page is mobile-first.
 */

/** Seed a monthly card + one entry in the current month directly into Dexie. */
async function seedMaryCard(page: Page): Promise<{ period: string }> {
  return page.evaluate(async () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const period = `${yyyy}-${mm}`;
    const entryDate = `${period}-10`;
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('hourtrack');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['cards', 'entries'], 'readwrite');
      tx.objectStore('cards').put({
        id: 'card-mary',
        name: 'Марі',
        color: '#2563EB',
        defaultDurationMin: 60,
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
      tx.objectStore('entries').put({
        id: 'entry-mary-1',
        cardId: 'card-mary',
        date: entryDate,
        startMinutes: 540,
        durationMin: 120,
        useCustomPayment: false,
        customPayment: null,
        note: null,
        googleEventId: null,
        syncStatus: 'pending',
        syncError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return { period };
  });
}

test.beforeEach(async ({ page }) => {
  await mockGisToken(page);
  await mockDriveApis(page, { existingFile: false });
  await mockCalendarApis(page);
  await page.goto('/login');
  await waitForAppDb(page);
  await seedAuthedSession(page, { onboardingSeen: true });
});

test('marks a retainer paid, updates the rollup, and persists across reload', async ({ page }) => {
  await page.goto('/');
  await seedMaryCard(page);

  await page.goto('/payments');
  await expect(page.getByTestId('payments-header')).toBeVisible({ timeout: 15_000 });

  const row = page.getByTestId('payment-row').filter({ hasText: 'Марі' });
  await expect(row).toBeVisible();
  // Expected retainer = 250 for the month with ≥1 entry.
  await expect(row.getByTestId('payment-row-expected')).toHaveText('250 €');
  await expect(row).toHaveAttribute('data-status', 'unpaid');

  // Mark received — amount prefilled with the remaining balance (250).
  await row.getByTestId('payment-row-mark-paid').click();
  const dialog = page.getByTestId('mark-paid-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/Amount|Сума|Importe/i)).toHaveValue('250');
  await dialog.getByTestId('mark-paid-confirm').click();

  // Chip flips to paid; the mark-paid button disappears.
  await expect(row).toHaveAttribute('data-status', 'paid');
  await expect(row.getByTestId('payment-row-mark-paid')).toHaveCount(0);

  // Rollup reflects the receipt.
  const rollup = page.getByTestId('payments-rollup');
  await expect(rollup).toContainText('250');

  // Reload — the payment persists (Dexie).
  await page.reload();
  await expect(page.getByTestId('payments-header')).toBeVisible({ timeout: 15_000 });
  const rowAfter = page.getByTestId('payment-row').filter({ hasText: 'Марі' });
  await expect(rowAfter).toHaveAttribute('data-status', 'paid');
});

test('partial payment shows the partial chip; a second payment completes it', async ({ page }) => {
  await page.goto('/');
  await seedMaryCard(page);

  await page.goto('/payments');
  await expect(page.getByTestId('payments-header')).toBeVisible({ timeout: 15_000 });

  const row = page.getByTestId('payment-row').filter({ hasText: 'Марі' });
  await row.getByTestId('payment-row-mark-paid').click();
  const dialog = page.getByTestId('mark-paid-dialog');
  const amount = dialog.getByLabel(/Amount|Сума|Importe/i);
  await amount.fill('120');
  await dialog.getByTestId('mark-paid-confirm').click();

  await expect(row).toHaveAttribute('data-status', 'partial');
  await expect(row.getByTestId('payment-row-received')).toContainText('120');

  // Reload — the partial payment persists (Dexie) and the remaining balance
  // recomputes to 130. Reloading also gives the dialog a fresh mount for the
  // second payment.
  await page.reload();
  await expect(page.getByTestId('payments-header')).toBeVisible({ timeout: 15_000 });
  const rowReloaded = page.getByTestId('payment-row').filter({ hasText: 'Марі' });
  await expect(rowReloaded).toHaveAttribute('data-status', 'partial');

  // Second payment for the remainder → paid. Amount prefilled with 130.
  await rowReloaded.getByTestId('payment-row-mark-paid').click();
  const dialog2 = page.getByTestId('mark-paid-dialog');
  await expect(dialog2.getByLabel(/Amount|Сума|Importe/i)).toHaveValue('130');
  await dialog2.getByTestId('mark-paid-confirm').click();

  await expect(rowReloaded).toHaveAttribute('data-status', 'paid');
});

test('undo toast removes the just-created payment', async ({ page }) => {
  await page.goto('/');
  await seedMaryCard(page);

  await page.goto('/payments');
  await expect(page.getByTestId('payments-header')).toBeVisible({ timeout: 15_000 });

  const row = page.getByTestId('payment-row').filter({ hasText: 'Марі' });
  await row.getByTestId('payment-row-mark-paid').click();
  const dialog = page.getByTestId('mark-paid-dialog');
  await dialog.getByTestId('mark-paid-confirm').click();
  await expect(row).toHaveAttribute('data-status', 'paid');

  // The sonner toast exposes an Undo action.
  await page.getByRole('button', { name: /Undo|Скасувати|Deshacer/i }).click();

  await expect(row).toHaveAttribute('data-status', 'unpaid');
});
