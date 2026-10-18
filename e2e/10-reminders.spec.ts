import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { seedAuthedSession } from './fixtures/auth';
import { waitForAppDb } from './fixtures/db';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * Golden Path #10 — Reminders (S28).
 *
 * Covers: create a reminder via the header bell (asserting the Google Calendar
 * event payload via a capture route), the due-reminders banner on load, marking
 * done, and the done-before-due Calendar-event delete. Runs under both
 * `chromium` and `mobile-iphone-13`. Delivery surfaces are in-app + Calendar
 * event ONLY — no Notification API / push anywhere.
 */

interface SeedReminderOptions {
  id: string;
  text: string;
  dueDate: string;
  dueMinutes: number;
  doneAt?: string | null;
  googleEventId?: string | null;
  /** Cache a calendar id in settings so delete ops have a target. */
  calendarId?: string;
}

/** Seed a reminder (and optionally a cached calendar id) directly into Dexie. */
async function seedReminder(page: Page, opts: SeedReminderOptions): Promise<void> {
  await page.evaluate(async (o) => {
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('hourtrack');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['reminders', 'settings'], 'readwrite');
      const now = new Date().toISOString();
      tx.objectStore('reminders').put({
        id: o.id,
        text: o.text,
        dueDate: o.dueDate,
        dueMinutes: o.dueMinutes,
        doneAt: o.doneAt ?? null,
        googleEventId: o.googleEventId ?? null,
        syncStatus: o.googleEventId ? 'synced' : 'pending',
        syncError: null,
        notifiedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      if (o.calendarId) {
        const settings = tx.objectStore('settings');
        const getReq = settings.get('current');
        getReq.onsuccess = () => {
          const existing = (getReq.result ?? {}) as Record<string, unknown>;
          settings.put({ ...existing, key: 'current', hourtrackCalendarId: o.calendarId });
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, opts);
}

/** Register a capture route recording Calendar event create/delete calls. */
async function captureCalendarEvents(page: Page): Promise<{
  created: Array<Record<string, unknown>>;
  deleted: string[];
}> {
  const created: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  await page.route('**/calendar/v3/calendars/**/events**', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'POST' && /\/events(\?|$)/.test(url)) {
      const body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
      created.push(body);
      const id = 'evt-' + Math.random().toString(36).slice(2, 8);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id, ...body }),
      });
      return;
    }
    const delMatch = url.match(/\/events\/([^/?]+)/);
    if (req.method() === 'DELETE' && delMatch) {
      deleted.push(decodeURIComponent(delMatch[1]!));
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fallback();
  });
  return { created, deleted };
}

test.beforeEach(async ({ page }) => {
  await mockGisToken(page);
  await mockDriveApis(page, { existingFile: false });
  await mockCalendarApis(page);
  await page.goto('/login');
  await waitForAppDb(page);
  await seedAuthedSession(page, { onboardingSeen: true });
});

test('creates a reminder from the bell and enqueues a Calendar event with the 🔔 payload', async ({
  page,
}) => {
  const events = await captureCalendarEvents(page);

  await page.goto('/');
  await expect(page.getByTestId('reminder-bell')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('reminder-bell').click();
  await page.getByTestId('reminder-add').click();

  const dialog = page.getByTestId('reminder-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Text|Текст|Texto/i).fill('Collect from Mary');
  await dialog.getByTestId('reminder-confirm').click();
  await expect(dialog).toBeHidden();

  // The reminder shows in the bell list.
  await page.getByTestId('reminder-bell').click();
  await expect(
    page.getByTestId('reminder-item').filter({ hasText: 'Collect from Mary' }),
  ).toBeVisible();

  // The Calendar create op drained with a 🔔-prefixed summary + popup override.
  await expect.poll(() => events.created.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const summary = events.created[0]!.summary as string;
  expect(summary).toContain('🔔');
  expect(summary).toContain('Collect from Mary');
  expect(events.created[0]!.reminders).toEqual({
    useDefault: false,
    overrides: [{ method: 'popup', minutes: 0 }],
  });
});

test('surfaces a due reminder in the banner on load and Done clears it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('reminder-bell')).toBeVisible({ timeout: 15_000 });
  // Seed a past-due, not-done reminder, then reload so the banner evaluates it
  // on a fresh app open.
  await seedReminder(page, {
    id: 'r-past',
    text: 'Collect overdue cash',
    dueDate: '2020-01-01',
    dueMinutes: 0,
  });
  await page.reload();

  const banner = page.getByTestId('due-reminders-banner');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText('Collect overdue cash');

  await banner.getByTestId('due-reminder-done').click();
  await expect(page.getByTestId('due-reminders-banner')).toBeHidden();
});

test('marking a future-due reminder done deletes its Calendar event', async ({ page }) => {
  const events = await captureCalendarEvents(page);

  await page.goto('/');
  await expect(page.getByTestId('reminder-bell')).toBeVisible({ timeout: 15_000 });
  // Future-due reminder that already has a synced Calendar event + a cached
  // calendar id so the delete op has a target.
  await seedReminder(page, {
    id: 'r-future',
    text: 'Collect next month',
    dueDate: '2999-01-01',
    dueMinutes: 540,
    googleEventId: 'evt-seed-1',
    calendarId: 'cal-mock@group.calendar.google.com',
  });
  await page.reload();

  await page.getByTestId('reminder-bell').click();
  const item = page.getByTestId('reminder-item').filter({ hasText: 'Collect next month' });
  await expect(item).toBeVisible();
  await item.getByTestId('reminder-item-done').click();

  // Done-before-due must delete the stale Calendar event.
  await expect.poll(() => events.deleted, { timeout: 15_000 }).toContain('evt-seed-1');
});

test('reminder bell + dialog have no critical a11y violations', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByTestId('reminder-bell')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('reminder-bell').click();
  await expect(page.getByTestId('reminder-add')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['region'])
    .analyze();

  const critical = results.violations.filter((v) => v.impact === 'critical');
  const seriousAndModerate = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'moderate',
  );
  if (seriousAndModerate.length > 0) {
    await testInfo.attach('a11y-warnings', {
      body: JSON.stringify(seriousAndModerate, null, 2),
      contentType: 'application/json',
    });
  }
  expect(
    critical,
    `Found ${critical.length} critical a11y violations: ${critical.map((v) => v.id).join(', ')}`,
  ).toHaveLength(0);
});
