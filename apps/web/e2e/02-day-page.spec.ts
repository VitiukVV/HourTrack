import { test, expect } from '@playwright/test';

import { seedAuthedSession } from './fixtures/auth';
import { waitForAppDb } from './fixtures/db';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * Golden Path #2 — Calendar day-click → entry create → DayPage edit.
 *
 * Flow:
 *   1. Authed user lands on Home with onboardingSeen=true (skip the tour
 *      for this spec — it's not what we're testing).
 *   2. Open the day page for a specific date.
 *   3. Add an entry via the picker.
 *   4. Verify the entry appears and the day total updates.
 */

test.beforeEach(async ({ page }) => {
  await mockGisToken(page);
  await mockDriveApis(page, { existingFile: false });
  await mockCalendarApis(page);
  await page.goto('/login');
  await waitForAppDb(page);
  // onboardingSeen=true so the tour doesn't get in the way of the test.
  await seedAuthedSession(page, { onboardingSeen: true });
});

test('Add entry to DayPage via the picker, entry appears, day total updates', async ({ page }) => {
  // Pre-seed a card so the picker has something to pick.
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
        id: 'card-day-picker',
        name: 'Acme',
        color: '#10B981',
        defaultDurationMin: 120,
        rateType: 'hourly',
        hourlyRate: 50,
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

  // Navigate directly to a specific date.
  const targetDate = '2026-05-14';
  await page.goto(`/day/${targetDate}`);

  // Empty state visible.
  await expect(page.getByTestId('day-page-empty')).toBeVisible();

  // Open picker via the empty-state CTA (or footer button — both work).
  await page.getByRole('button', { name: /\+ add entry to this day/i }).click();

  // DayPickerModal opens — pick the Acme card.
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /Acme/ }).click();

  // Entry editor renders.
  await expect(page.getByTestId('entry-editor').first()).toBeVisible();

  // Day total updates — 2H 0M (defaultDurationMin=120) and 100.00 EUR (50/h × 2h).
  await expect(page.getByTestId('day-page-total')).toContainText('2h 0m');
  await expect(page.getByTestId('day-page-total')).toContainText('100.00 EUR');
});

/**
 * S32 / UR-32-2 — a day can hold several entries, and a new one must land at
 * its chronological position instead of being appended. Before S32 the
 * DayPage list came back from `getEntriesByDate` unsorted, so a 07:00 entry
 * added to a 09:00 + 14:00 day rendered last.
 */
test('New entry lands at its chronological position on a day that already has entries', async ({
  page,
}) => {
  const targetDate = '2026-05-14';

  await page.goto('/');
  await page.evaluate(async (date: string) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('hourtrack');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const now = new Date().toISOString();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['cards', 'entries'], 'readwrite');
      tx.objectStore('cards').put({
        id: 'card-s32-order',
        name: 'Early',
        color: '#10B981',
        defaultDurationMin: 60,
        // The picker creates the new entry at the card's default start.
        defaultStartMinutes: 7 * 60,
        rateType: 'hourly',
        hourlyRate: 50,
        fixedTotal: null,
        monthlyTotal: null,
        defaultNote: null,
        isArchived: false,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      // Seeded out of order on purpose — the query, not insertion order,
      // decides what the page shows.
      for (const [id, startMinutes] of [
        ['entry-s32-two', 14 * 60],
        ['entry-s32-nine', 9 * 60],
      ] as const) {
        tx.objectStore('entries').put({
          id,
          cardId: 'card-s32-order',
          date,
          startMinutes,
          durationMin: 60,
          useCustomPayment: false,
          customPayment: null,
          note: null,
          googleEventId: null,
          syncStatus: 'pending',
          syncError: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, targetDate);

  await page.goto(`/day/${targetDate}`);

  const starts = () =>
    page.getByTestId('entry-editor').locator('input[type="time"]').first().inputValue();

  // Two seeded rows, already in start-time order despite the seed order.
  await expect(page.getByTestId('entry-editor')).toHaveCount(2);
  expect(await starts()).toBe('09:00');

  // Add a third entry at the card's 07:00 default.
  await page.getByRole('button', { name: /\+ add entry to this day/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /Early/ }).click();

  await expect(page.getByTestId('entry-editor')).toHaveCount(3);
  // It renders FIRST, not last.
  await expect
    .poll(async () =>
      page.getByTestId('entry-editor').locator('input[type="time"]').first().inputValue(),
    )
    .toBe('07:00');

  // Each editor row carries TWO time inputs (start and end) — take the first
  // one per row, not the first N across the list.
  const allStarts = await page
    .getByTestId('entry-editor')
    .evaluateAll((rows) =>
      rows.map((r) => r.querySelector<HTMLInputElement>('input[type="time"]')?.value ?? ''),
    );
  expect(allStarts).toEqual(['07:00', '09:00', '14:00']);
});
