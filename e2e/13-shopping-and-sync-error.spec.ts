import { test, expect, type Page } from '@playwright/test';

import { seedAuthedSession } from './fixtures/auth';
import { waitForAppDb } from './fixtures/db';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * Specs 014 + 015 — phone-width layout.
 *
 *   - 014: an entry whose calendar sync failed with a long error used to make
 *     the edit dialog wider than the screen (the error never wrapped).
 *   - 015: the Purchases page and the five-item bottom nav fit a phone.
 *
 * "Fits" is measured, not eyeballed: nothing may extend past the viewport.
 */

const LONG_ERROR =
  'Calendar API error 401 Unauthorized: {"error":{"code":401,"message":"Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project."}}';

function today(): { period: string; date: string } {
  const d = new Date();
  const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { period, date: `${period}-10` };
}

async function seed(page: Page): Promise<void> {
  const { period, date } = today();
  await page.evaluate(
    async ({ period, date, longError }) => {
      const now = new Date().toISOString();
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('hourtrack');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['cards', 'entries', 'shoppingItems'], 'readwrite');
        tx.objectStore('cards').put({
          id: 'card-raquel',
          name: 'Raquel',
          color: '#2563EB',
          position: 0,
          defaultDurationMin: 150,
          defaultStartMinutes: 540,
          rateType: 'hourly',
          hourlyRate: 12,
          fixedTotal: null,
          monthlyTotal: null,
          defaultNote: null,
          isArchived: false,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        tx.objectStore('entries').put({
          id: 'entry-raquel',
          cardId: 'card-raquel',
          date,
          startMinutes: 540,
          durationMin: 150,
          useCustomPayment: false,
          customPayment: null,
          note: 'Купити:\nБілі пакети',
          googleEventId: 'evt-1',
          syncStatus: 'error',
          syncError: longError,
          createdAt: now,
          updatedAt: now,
        });
        tx.objectStore('shoppingItems').put({
          id: 'item-bags',
          cardId: 'card-raquel',
          text: 'Білі пакети для сміття — великі, 120 л, щільні, бажано з зав’язками, щоб вистачило на місяць',
          addedPeriod: period,
          boughtAt: null,
          boughtPeriod: null,
          createdAt: now,
          updatedAt: now,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { period, date, longError: LONG_ERROR },
  );
}

/** Widest right edge of any element, vs the viewport width. */
async function overflow(page: Page): Promise<{ right: number; viewport: number; scroll: number }> {
  return page.evaluate(() => {
    let right = 0;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) right = Math.max(right, r.right);
    }
    return {
      right,
      viewport: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
    };
  });
}

test.use({ viewport: { width: 360, height: 780 } });

test.beforeEach(async ({ page }) => {
  await mockGisToken(page);
  await mockDriveApis(page, { existingFile: false });
  await mockCalendarApis(page);
  await page.goto('/login');
  await waitForAppDb(page);
  await seedAuthedSession(page, { onboardingSeen: true });
  await page.goto('/');
  await seed(page);
});

test('014: the entry dialog with a long sync error stays within the screen', async ({ page }) => {
  await page.reload();
  const chip = page.getByTestId(`day-cell-${today().date}`).getByTestId('entry-chip').first();
  await chip.click();
  const banner = page.getByTestId('entry-editor-sync-error');
  await expect(banner).toBeVisible();
  // The raw API text is replaced by the localized sign-in hint.
  await expect(banner).not.toContainText('https://');

  const dialog = page.getByRole('dialog');
  const box = await dialog.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(360 + 0.5);
  const m = await overflow(page);
  expect(m.right).toBeLessThanOrEqual(m.viewport + 0.5);
  await expect(page.getByTestId('entry-editor-sync-retry')).toBeInViewport();
});

test('015: Purchases and the five-item bottom nav fit a 360 px phone', async ({ page }) => {
  await page.goto('/shopping');
  await expect(page.getByTestId('shopping-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('shopping-item')).toHaveCount(1);

  const m = await overflow(page);
  expect(m.scroll).toBeLessThanOrEqual(m.viewport);
  expect(m.right).toBeLessThanOrEqual(m.viewport + 0.5);

  const links = page.getByTestId('bottom-nav').getByRole('link');
  await expect(links).toHaveCount(5);
  for (const link of await links.all()) await expect(link).toBeInViewport({ ratio: 1 });

  await page.screenshot({ path: 'test-results/shopping-360.png', fullPage: true });
});
