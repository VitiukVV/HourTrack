import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Reminder } from '@hourtrack/shared-types';

/**
 * S31 Task 13 (UR-31-7) — the RemindersScheduler COMPONENT's timer wiring was
 * untested (only the pure `reminderScheduling` selectors were covered). This
 * suite drives the 60s `setInterval`, the `visibilitychange` re-check, and the
 * unmount cleanup with FAKE TIMERS. The Dexie layer + mutations are mocked, so
 * we avoid the fake-timers + fake-indexeddb deadlock the S28 journal flagged.
 */

const h = vi.hoisted(() => {
  return {
    reminders: [] as Reminder[],
    listOpenReminders: vi.fn(),
    notifiedMutate: vi.fn(),
    doneMutate: vi.fn(),
    toast: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  db: {},
  listOpenReminders: (...args: unknown[]) => {
    h.listOpenReminders(...args);
    // Return a fresh copy so component reads reflect mutation-driven stamps.
    return Promise.resolve(h.reminders.map((r) => ({ ...r })));
  },
}));

vi.mock('./useReminders', () => ({
  useMarkReminderNotifiedMutation: () => ({ mutate: h.notifiedMutate }),
  useMarkReminderDoneMutation: () => ({ mutate: h.doneMutate }),
}));

vi.mock('sonner', () => ({
  toast: (...args: unknown[]) => h.toast(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { reminderDueMomentMs } from './reminderScheduling';
import { RemindersScheduler } from './RemindersScheduler';

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1',
    text: 'Collect cash',
    dueDate: '2026-08-04',
    dueMinutes: 540, // 09:00 local
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

beforeEach(() => {
  vi.useFakeTimers();
  h.reminders = [];
  h.listOpenReminders.mockClear();
  h.notifiedMutate.mockReset();
  h.doneMutate.mockReset();
  h.toast.mockReset();
  // markNotified stamps notifiedAt on the shared state so the next tick's
  // selectDueToasts excludes it (the real once-only de-dupe).
  h.notifiedMutate.mockImplementation((id: string) => {
    const r = h.reminders.find((x) => x.id === id);
    if (r) r.notifiedAt = new Date().toISOString();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RemindersScheduler component (S31 / UR-31-7)', () => {
  it('toasts exactly once when a reminder crosses due while open (second tick does not re-toast)', async () => {
    // Mount 30s BEFORE due → mount tick sees it as not-yet-due (no toast).
    vi.setSystemTime(DUE - 30_000);
    h.reminders = [makeReminder()];

    const { unmount } = render(<RemindersScheduler />);
    await vi.advanceTimersByTimeAsync(0); // flush the mount tick
    expect(h.toast).toHaveBeenCalledTimes(0);

    // Advance one 60s tick → now is 30s AFTER due → toast fires once.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.notifiedMutate).toHaveBeenCalledWith('r1');

    // Another 60s tick → notifiedAt is stamped → NO second toast.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.toast).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('re-checks on regaining visibility (visibilitychange → visible)', async () => {
    vi.setSystemTime(DUE - 30_000);
    h.reminders = [makeReminder()];

    render(<RemindersScheduler />);
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterMount = h.listOpenReminders.mock.calls.length;

    // Return to the tab → a fresh check runs.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(h.listOpenReminders.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('clears the interval on unmount (no ticks after teardown)', async () => {
    vi.setSystemTime(DUE - 30_000);
    h.reminders = [makeReminder()];

    const { unmount } = render(<RemindersScheduler />);
    await vi.advanceTimersByTimeAsync(0);
    unmount();

    const callsAfterUnmount = h.listOpenReminders.mock.calls.length;
    await vi.advanceTimersByTimeAsync(180_000); // 3 more tick windows
    expect(h.listOpenReminders.mock.calls.length).toBe(callsAfterUnmount);
  });
});
