import { afterEach, describe, expect, it, vi } from 'vitest';

const enqueue = vi.fn();
vi.mock('./SyncManager', () => ({ getSyncManager: () => ({ enqueue }) }));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

import i18n from '@/lib/i18n/i18n';

import { enqueueSync } from './enqueueSync';

/** Spec 009 — a sync op that never reached the queue is told to the user. */

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('enqueueSync', () => {
  it('stays quiet when the op is queued', async () => {
    enqueue.mockResolvedValueOnce(undefined);
    enqueueSync({ op: 'pushDataJson' }, 'test');
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('logs, toasts once under a shared id, and hands the error to onFailure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    enqueue.mockRejectedValue(new Error('quota'));
    const onFailure = vi.fn();

    enqueueSync({ op: 'pushDataJson' }, 'test', { onFailure });
    enqueueSync({ op: 'createCalendarEvent', entityId: 'e1' }, 'test');

    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
    const ids = toastError.mock.calls.map((c) => (c[1] as { id: string }).id);
    expect(new Set(ids).size).toBe(1);
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'quota' }));
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('uses the caller copy when given', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    enqueue.mockRejectedValueOnce(new Error('quota'));
    enqueueSync({ op: 'pushDataJson' }, 'test', { toastKey: 'cards.reorder.syncFailed' });
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0]![0]).toBe(i18n.t('cards.reorder.syncFailed'));
  });
});
