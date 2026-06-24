import { test, expect } from '@playwright/test';

import { seedAuthedSession } from './fixtures/auth';
import { waitForAppDb } from './fixtures/db';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * S17 — Inline entry edit from MonthView.
 *
 * Flow:
 *   1. Authed user on Home (MonthView).
 *   2. Seed one card + one entry directly into IndexedDB so we don't depend
 *      on the day-click → DayPickerModal → DayPage detour (that's covered by
 *      02-day-page.spec.ts; here we want the chip-click → modal → save
 *      round-trip in isolation).
 *   3. Click the chip on the seeded day cell.
 *   4. The EntryEditModal opens with the entry's data prefilled.
 *   5. Change the start time via the visible time input.
 *   6. Click Save.
 *   7. Modal closes.
 *   8. MonthView chip text reflects the new start time.
 */

// MonthView anchors to "today" on mount, so the seeded cell must fall inside
// the current month's grid. Seed on the 14th of the CURRENT month (always a
// non-leading/trailing cell) rather than a fixed past date that drifts
// off-grid as the calendar's real "today" advances.
const NOW = new Date();
const SEEDED_DATE = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-14`;
const SEEDED_ENTRY_ID = 'entry-s17-modal-e2e';
const SEEDED_CARD_ID = 'card-s17-modal-e2e';

test.beforeEach(async ({ page }) => {
  await mockGisToken(page);
  await mockDriveApis(page, { existingFile: false });
  await mockCalendarApis(page);
  await page.goto('/login');
  await waitForAppDb(page);
  await seedAuthedSession(page, { onboardingSeen: true });
});

test('Click chip on MonthView → modal opens → edit start time → save → chip reflects new time', async ({
  page,
}) => {
  // Anchor the calendar to the seeded month so the cell is visible.
  await page.goto('/');

  // Seed a card + entry directly into IndexedDB. We use deterministic ids
  // so the assertions don't depend on Dexie's auto-generated values.
  await page.evaluate(
    async ({ entryId, cardId, date }) => {
      const open = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('hourtrack');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const dbInner = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = dbInner.transaction(['cards', 'entries'], 'readwrite');
        const now = new Date().toISOString();
        tx.objectStore('cards').put({
          id: cardId,
          name: 'Acme',
          color: '#10B981',
          defaultDurationMin: 120,
          defaultStartMinutes: 540,
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
        tx.objectStore('entries').put({
          id: entryId,
          cardId,
          date,
          startMinutes: 9 * 60, // 09:00
          durationMin: 120,
          useCustomPayment: false,
          customPayment: null,
          note: null,
          googleEventId: null,
          syncStatus: 'pending',
          syncError: null,
          createdAt: now,
          updatedAt: now,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      dbInner.close();
    },
    { entryId: SEEDED_ENTRY_ID, cardId: SEEDED_CARD_ID, date: SEEDED_DATE },
  );

  // Reload so MonthView re-runs its entries-in-range query against the
  // newly seeded row. Anchor the calendar to May 2026 via the URL hash —
  // HomePage just renders MonthView from the calendarStore, but a hard
  // reload ensures we see the fresh data.
  await page.reload();

  // The seeded cell appears with one chip.
  const seededCell = page.getByTestId(`day-cell-${SEEDED_DATE}`);
  await expect(seededCell).toBeVisible({ timeout: 10_000 });
  const chip = seededCell.getByTestId('entry-chip').first();
  await expect(chip).toBeVisible();
  // The MonthView `bar` chip is name-only since S21 (UR-21-1): the start
  // time moved out of the visible text into the accessible name / title.
  await expect(chip).toContainText('Acme');
  await expect(chip).toHaveAttribute('aria-label', /^09:00\b/);

  // Click the chip → modal opens.
  await chip.click();
  const dialog = page.getByRole('dialog').first();
  await expect(dialog).toBeVisible();
  // Title mentions the card name (i18n key entryEdit.title interpolates {{card}}).
  await expect(dialog).toContainText('Acme');

  // Start-time input prefilled to 09:00.
  const timeInput = dialog.getByLabel(/start time/i);
  await expect(timeInput).toHaveValue('09:00');

  // Change to 14:30 — Playwright's `fill` on `<input type="time">` accepts
  // HH:MM directly.
  await timeInput.fill('14:30');

  // Save → modal closes, chip reflects the new time.
  await dialog.getByRole('button', { name: /save/i }).click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });

  // The chip's accessible name reflects the new start time after the
  // mutation patches the entries-in-range cache (name-only bar, S21).
  await expect(chip).toHaveAttribute('aria-label', /^14:30\b/, { timeout: 5_000 });

  // DB-level assertion: the persisted row carries the new startMinutes.
  const persisted = await page.evaluate(async (id: string) => {
    const dbInner = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('hourtrack');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = dbInner.transaction(['entries'], 'readonly');
      const req = tx.objectStore('entries').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbInner.close();
    return value as { startMinutes?: number } | undefined;
  }, SEEDED_ENTRY_ID);
  expect(persisted?.startMinutes).toBe(14 * 60 + 30);
});
