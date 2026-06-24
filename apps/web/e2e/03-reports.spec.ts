import { test, expect } from '@playwright/test';

import { seedAuthedSession } from './fixtures/auth';
import { waitForAppDb } from './fixtures/db';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * Golden Path #3 — Reports page shows correct totals.
 *
 * Flow:
 *   1. Seed a card + a couple of entries spanning the current month.
 *   2. Navigate to /reports.
 *   3. Default filters: current month + all cards.
 *   4. Verify the total time and total earnings match the seeded entries.
 *
 * S13 lazy-loaded the /reports route (deferred Recharts). S15 removed
 * Recharts and inlined the route — there's no Suspense boundary to wait on
 * anymore, the filters bar mounts on first paint.
 */

test.beforeEach(async ({ page }) => {
  await mockGisToken(page);
  await mockDriveApis(page, { existingFile: false });
  await mockCalendarApis(page);
  await page.goto('/login');
  await waitForAppDb(page);
  await seedAuthedSession(page, { onboardingSeen: true });
});

test('Reports page surfaces totals computed from seeded entries', async ({ page }) => {
  await page.goto('/');
  // Seed a card + entries inside the user's current month so default filters cover them.
  await page.evaluate(async () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const d1 = `${yyyy}-${mm}-05`;
    const d2 = `${yyyy}-${mm}-12`;
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
        id: 'card-reports',
        name: 'ReportsCard',
        color: '#F59E0B',
        defaultDurationMin: 240,
        rateType: 'hourly',
        hourlyRate: 25,
        fixedTotal: null,
        monthlyTotal: null,
        defaultNote: null,
        isArchived: false,
        archivedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      tx.objectStore('entries').put({
        id: 'entry-1',
        cardId: 'card-reports',
        date: d1,
        durationMin: 120, // 2h
        useCustomPayment: false,
        customPayment: null,
        note: null,
        googleEventId: null,
        syncStatus: 'pending',
        syncError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      tx.objectStore('entries').put({
        id: 'entry-2',
        cardId: 'card-reports',
        date: d2,
        durationMin: 180, // 3h
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
  });

  await page.goto('/reports');

  // The filters bar should mount on first paint now that /reports is a direct
  // import (S15). Keep a generous timeout to absorb slower CI runners.
  await expect(page.getByTestId('reports-filters')).toBeVisible({ timeout: 15_000 });

  // Total time: 120 + 180 = 300min = 5H 0M.
  // S15: the per-card breakdown table is gone; the totals only show up in
  // the metrics block. Keep the scoped locator so the assertion stays
  // unambiguous if the table ever surfaces a hours subtotal again.
  const metrics = page.getByTestId('reports-metrics');
  await expect(metrics.getByText('5H 0M')).toBeVisible();
  // Total earnings: 5h × 25/h = 125.00 EUR.
  await expect(metrics.getByText(/125\.00 EUR/)).toBeVisible();
});
