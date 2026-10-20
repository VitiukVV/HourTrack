import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Reminder } from '@/shared/types';

/**
 * Spec 013 — the scheduler's system-notification branch. Same fake-timer +
 * mocked-Dexie setup as `RemindersScheduler.component.test.tsx`; the
 * notification modules are mocked so each test picks status / visibility /
 * posting outcome directly.
 */

const h = vi.hoisted(() => ({
  reminders: [] as Reminder[],
  notifiedMutate: vi.fn(),
  toast: vi.fn(),
  status: 'on' as 'unsupported' | 'off' | 'on' | 'blocked',
  show: vi.fn(),
  closeStale: vi.fn(),
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

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@/features/notifications/notificationPrefs', () => ({
  readNotificationsEnabled: () => true,
}));
vi.mock('@/features/notifications/notificationSupport', () => ({
  getNotificationStatus: () => h.status,
}));
vi.mock('@/features/notifications/showReminderNotification', () => ({
  showReminderNotification: (...args: unknown[]) => h.show(...args),
  closeStaleReminderNotifications: (...args: unknown[]) => h.closeStale(...args),
}));

import { reminderDueMomentMs } from './reminderScheduling';
import { RemindersScheduler } from './RemindersScheduler';

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
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
    ...overrides,
  };
}

const DUE = reminderDueMomentMs(makeReminder());

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

/** Mount before due, then cross due with one 60s tick. */
async function crossDue() {
  vi.setSystemTime(DUE - 30_000);
  const view = render(<RemindersScheduler />);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_000);
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  h.reminders = [makeReminder()];
  h.status = 'on';
  h.toast.mockReset();
  h.show.mockReset().mockResolvedValue(true);
  h.closeStale.mockReset().mockResolvedValue(undefined);
  h.notifiedMutate.mockReset().mockImplementation((id: string) => {
    const r = h.reminders.find((x) => x.id === id);
    if (r) r.notifiedAt = new Date().toISOString();
  });
  setVisibility('hidden');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setVisibility('visible');
});

describe('RemindersScheduler — system notifications (spec 013)', () => {
  it('in the background with notifications on, posts a system notification instead of a toast', async () => {
    await crossDue();
    expect(h.show).toHaveBeenCalledTimes(1);
    expect(h.show).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1', text: 'Collect cash' }),
    );
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.notifiedMutate).toHaveBeenCalledTimes(1);
  });

  it('does not notify the same reminder twice', async () => {
    await crossDue();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.show).toHaveBeenCalledTimes(1);
  });

  it('while visible, only toasts', async () => {
    setVisibility('visible');
    await crossDue();
    expect(h.show).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledTimes(1);
  });

  it.each(['off', 'blocked', 'unsupported'] as const)(
    'with status %s, toasts as before',
    async (status) => {
      h.status = status;
      await crossDue();
      expect(h.show).not.toHaveBeenCalled();
      expect(h.toast).toHaveBeenCalledTimes(1);
    },
  );

  it('falls back to the toast when there is nothing to post through', async () => {
    h.show.mockResolvedValue(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await crossDue();
    expect(h.toast).toHaveBeenCalledTimes(1);
  });

  it('falls back to the toast when posting throws', async () => {
    h.show.mockRejectedValue(new Error('boom'));
    vi.stubGlobal('Notification', { permission: 'granted' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await crossDue();
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does not notify reminders that were already due when the app started', async () => {
    vi.setSystemTime(DUE + 5 * 60_000);
    render(<RemindersScheduler />);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.show).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('closes notifications of reminders that are no longer open on every tick', async () => {
    h.reminders = [makeReminder({ id: 'a' }), makeReminder({ id: 'b' })];
    vi.setSystemTime(DUE - 30_000);
    render(<RemindersScheduler />);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.closeStale).toHaveBeenLastCalledWith(
      new Map([
        ['a', 'Collect cash'],
        ['b', 'Collect cash'],
      ]),
    );

    h.reminders = [makeReminder({ id: 'a' })];
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.closeStale).toHaveBeenLastCalledWith(new Map([['a', 'Collect cash']]));
  });

  it('a failing stale-close does not stop the due check', async () => {
    h.closeStale.mockRejectedValue(new Error('nope'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await crossDue();
    expect(h.show).toHaveBeenCalledTimes(1);
  });
});

describe('RemindersScheduler — several reminders in one tick (spec 013)', () => {
  it('posts one notification per reminder', async () => {
    h.reminders = [makeReminder({ id: 'a', text: 'A' }), makeReminder({ id: 'b', text: 'B' })];
    await crossDue();
    expect(h.show).toHaveBeenCalledTimes(2);
    expect(h.show).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'a' }));
    expect(h.show).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'b' }));
    expect(h.notifiedMutate).toHaveBeenCalledTimes(2);
    expect(h.toast).not.toHaveBeenCalled();
  });
});
