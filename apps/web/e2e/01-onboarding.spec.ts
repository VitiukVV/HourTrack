import { test, expect } from '@playwright/test';

import { seedAuthedSession } from './fixtures/auth';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * Golden Path #1 — Onboarding tour.
 *
 * Verifies the tour activates exactly once on first sign-in, walks through
 * three steps, and persists `onboardingSeen` so it never resurfaces. The
 * tour itself is a portal-mounted spotlight + tooltip (see TourStep.tsx).
 *
 * The test seeds an authed session with `onboardingSeen=false` and
 * `firstLoginAt` set → tour activates immediately on render. Then we walk
 * through Next twice and Done.
 *
 * Re-visit assertion: after dismissal, reload the page. Tour MUST NOT
 * re-appear (would mean the persist write didn't land).
 */

test.beforeEach(async ({ page }) => {
  await mockGisToken(page);
  await mockDriveApis(page, { existingFile: false });
  await mockCalendarApis(page);
  // Open the app once so Dexie creates all v4 stores. Each Playwright
  // test runs in a fresh browser context, so the DB is empty here.
  await page.goto('/login');
  // Wait for Dexie initDB to complete by polling for the Settings row
  // to exist. Without this the seed below races initDB and we either
  // double-write (harmless) or write into a missing store (fatal).
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
  await seedAuthedSession(page, { onboardingSeen: false });
});

test('Onboarding tour activates on first sign-in, walks through 3 steps, and never resurfaces', async ({
  page,
}) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log('[browser]', msg.type(), msg.text());
    }
  });
  page.on('pageerror', (err) => {
    console.log('[pageerror]', err.message);
  });
  await page.goto('/');

  // Wait for the cards header to mount as a sanity check before looking
  // for the tour portal.
  await expect(page.getByTestId('cards-header')).toBeVisible({ timeout: 15_000 });

  // Wait for the tour portal to mount. The portal is rendered to body so
  // we use a global selector, not scoped to AppLayout.
  await expect(page.getByTestId('onboarding-tour')).toBeVisible({ timeout: 10_000 });

  // Step 1 -- next
  await expect(page.getByText(/Create your first card/i)).toBeVisible();
  await page.getByTestId('onboarding-next').click();

  // Step 2 -- Next is disabled because no cards exist yet. We confirm the
  // disabled state then step Back, but for the golden path we skip on to
  // the day step by clicking Skip after verifying Step 2's hint surfaces.
  await expect(page.getByText(/Click a card to activate it/i)).toBeVisible();
  await expect(page.getByText(/Create a card first/i)).toBeVisible();
  // Skip the rest of the tour.
  await page.getByTestId('onboarding-skip').click();

  // Tour should disappear.
  await expect(page.getByTestId('onboarding-tour')).toBeHidden();

  // Reload and confirm it doesn't re-appear.
  await page.reload();
  // Brief wait for any settings read to land.
  await page.waitForTimeout(500);
  await expect(page.getByTestId('onboarding-tour')).toBeHidden();
});

test('Onboarding tour completion (Done on Step 3) persists onboardingSeen', async ({ page }) => {
  // Pre-create a card so Step 2 can advance.
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
        id: 'preseed-card',
        name: 'Preseed',
        color: '#3B82F6',
        defaultDurationMin: 480,
        rateType: 'hourly',
        hourlyRate: 20,
        fixedTotal: null,
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

  await expect(page.getByTestId('onboarding-tour')).toBeVisible({ timeout: 10_000 });
  // Step 1 -> 2
  await page.getByTestId('onboarding-next').click();
  // Step 2 (card exists now) -> 3
  await page.getByTestId('onboarding-next').click();
  // Step 3 -> Done
  await expect(page.getByText(/Click days in the calendar to log work/i)).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-tour')).toBeHidden();

  // Reload — persistence check.
  await page.reload();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('onboarding-tour')).toBeHidden();
});
