import { render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Reminder } from '@/shared/types';
import i18n from '@/lib/i18n/i18n';
import { writeNotificationsEnabled } from '@/features/notifications/notificationPrefs';
import { installNotificationEnv, type FakeNotificationEnv } from '@/test-utils/notificationEnv';

/**
 * Spec 013 — the scheduler against the REAL per-device switch, permission
 * check and posting module (only Dexie, mutations and the toast are mocked),
 * so turning notifications off in Settings is proven to reach the scheduler.
 */

const h = vi.hoisted(() => ({
  reminders: [] as Reminder[],
  notifiedMutate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {},
  listOpenReminders: () => Promise.resolve(h.reminders.map((r) => ({ ...r }))),
}));
vi.mock('./useReminders', () => ({
  useMarkReminderNotifiedMutation: () => ({ mutate: h.notifiedMutate }),
  useMarkReminderDoneMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => h.toast(...args) }));

import { reminderDueMomentMs } from './reminderScheduling';
import { RemindersScheduler } from './RemindersScheduler';

const REMINDER: Reminder = {
  id: 'r1',
  text: 'Collect cash',
  dueDate: '2026-08-04',
  dueMinutes: 540,
  doneAt: null,
  googleEventId: null,
  syncStatus: 'pending',
  syncError: null,
  notifiedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};
const DUE = reminderDueMomentMs(REMINDER);

let env: FakeNotificationEnv;

// Load the locale up front: `useTranslation` suspends until it is in, and a
// suspended scheduler never mounts its timers.
beforeAll(async () => {
  await i18n.changeLanguage('en');
});

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

async function crossDue() {
  vi.setSystemTime(DUE - 30_000);
  render(<RemindersScheduler />);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_000);
}

beforeEach(() => {
  vi.useFakeTimers();
  h.reminders = [{ ...REMINDER }];
  h.toast.mockReset();
  h.notifiedMutate.mockReset();
  env = installNotificationEnv({ permission: 'granted' });
  setVisibility('hidden');
});

afterEach(() => {
  vi.useRealTimers();
  env.restore();
  localStorage.clear();
  setVisibility('visible');
});

describe('RemindersScheduler with the real notification switch', () => {
  it('switched on: posts the system notification with the reminder text', async () => {
    writeNotificationsEnabled(true);
    await crossDue();
    expect(env.shown).toEqual([
      expect.objectContaining({ tag: 'reminder:r1', body: 'Collect cash' }),
    ]);
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('switched off in Settings: toast only, no system notification', async () => {
    writeNotificationsEnabled(true);
    writeNotificationsEnabled(false);
    await crossDue();
    expect(env.registration.showNotification).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledTimes(1);
  });

  it('permission revoked in phone settings: toast only', async () => {
    writeNotificationsEnabled(true);
    env.setPermission('denied');
    await crossDue();
    expect(env.registration.showNotification).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledTimes(1);
  });
});
