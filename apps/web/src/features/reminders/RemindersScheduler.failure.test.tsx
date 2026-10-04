import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Reminder } from '@hourtrack/shared-types';

import { RemindersScheduler } from './RemindersScheduler';

/**
 * Spec 007 (FR-005) — the "Done" action on a due-reminder toast reports a
 * failed write like the banner and bell do, instead of doing nothing.
 */

const reminder = { id: 'r1', text: 'Invoice' } as Reminder;
const markDone = vi.fn();
const markNotified = vi.fn();

vi.mock('@/lib/db', () => ({ db: {}, listOpenReminders: () => Promise.resolve([reminder]) }));
vi.mock('./reminderScheduling', () => ({ selectDueToasts: () => [reminder] }));
vi.mock('./useReminders', () => ({
  useMarkReminderDoneMutation: () => ({ mutate: markDone }),
  useMarkReminderNotifiedMutation: () => ({ mutate: markNotified }),
}));
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RemindersScheduler — failure is visible', () => {
  it('toasts when marking a reminder done from its toast fails', async () => {
    const { toast } = await import('sonner');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<RemindersScheduler />);
    await waitFor(() => expect(toast).toHaveBeenCalled());

    const options = vi.mocked(toast).mock.calls[0]![1] as unknown as {
      action: { onClick: () => void };
    };
    options.action.onClick();
    const handlers = markDone.mock.calls[0]![1] as { onError: (err: Error) => void };
    handlers.onError(new Error('disk full'));

    expect(toast.error).toHaveBeenCalled();
  });

  it('logs when the notified stamp fails', async () => {
    const { toast } = await import('sonner');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<RemindersScheduler />);
    await waitFor(() => expect(toast).toHaveBeenCalled());

    const handlers = markNotified.mock.calls[0]![1] as { onError: (err: Error) => void };
    handlers.onError(new Error('disk full'));

    expect(log).toHaveBeenCalled();
  });
});
