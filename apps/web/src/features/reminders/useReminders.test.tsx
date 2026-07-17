import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { createReminder, db } from '@/lib/db';

interface EnqueuedOp {
  op: string;
  payload?: Record<string, unknown>;
}
const enqueue = vi.fn((_op: EnqueuedOp) => Promise.resolve());

vi.mock('@/features/sync/SyncManager', () => ({
  getSyncManager: () => ({ enqueue }),
}));

import {
  useCreateReminderMutation,
  useDeleteReminderMutation,
  useMarkReminderDoneMutation,
} from './useReminders';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(async () => {
  enqueue.mockClear();
  await db.reminders.clear();
  await db.tombstones.clear();
  await db.syncQueue.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

function opsOf(op: string): EnqueuedOp[] {
  return enqueue.mock.calls.map((c) => c[0]).filter((a) => a.op === op);
}

describe('useCreateReminderMutation', () => {
  it('creates a reminder and enqueues push + createReminderEvent', async () => {
    const { result } = renderHook(() => useCreateReminderMutation(), { wrapper: wrapper() });
    await result.current.mutateAsync({ text: 'X', dueDate: '2026-08-04', dueMinutes: 540 });
    await waitFor(() => expect(opsOf('createReminderEvent')).toHaveLength(1));
    expect(opsOf('pushDataJson')).toHaveLength(1);
    expect(await db.reminders.count()).toBe(1);
  });
});

describe('useMarkReminderDoneMutation — done-before-due deletes the event', () => {
  it('enqueues deleteReminderEvent when the due time is still in the future', async () => {
    // Due far in the future relative to "now".
    const future = new Date(Date.now() + 7 * 86_400_000);
    const dueDate = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(
      future.getDate(),
    ).padStart(2, '0')}`;
    await createReminder(db, {
      id: 'r-future',
      text: 'later',
      dueDate,
      dueMinutes: 600,
      doneAt: null,
      googleEventId: 'evt-1',
      syncStatus: 'synced',
      syncError: null,
      notifiedAt: null,
    });

    const { result } = renderHook(() => useMarkReminderDoneMutation(), { wrapper: wrapper() });
    await result.current.mutateAsync('r-future');

    await waitFor(() => expect(opsOf('deleteReminderEvent')).toHaveLength(1));
    expect(opsOf('deleteReminderEvent')[0]).toMatchObject({
      payload: { googleEventId: 'evt-1' },
    });
  });

  it('does NOT enqueue a delete for a past-due done reminder', async () => {
    const past = new Date(Date.now() - 7 * 86_400_000);
    const dueDate = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(
      past.getDate(),
    ).padStart(2, '0')}`;
    await createReminder(db, {
      id: 'r-past',
      text: 'earlier',
      dueDate,
      dueMinutes: 600,
      doneAt: null,
      googleEventId: 'evt-2',
      syncStatus: 'synced',
      syncError: null,
      notifiedAt: null,
    });

    const { result } = renderHook(() => useMarkReminderDoneMutation(), { wrapper: wrapper() });
    await result.current.mutateAsync('r-past');

    await waitFor(() => expect(opsOf('pushDataJson')).toHaveLength(1));
    expect(opsOf('deleteReminderEvent')).toHaveLength(0);
  });
});

describe('useDeleteReminderMutation', () => {
  it('deletes the reminder and always enqueues deleteReminderEvent when synced', async () => {
    await createReminder(db, {
      id: 'r-del',
      text: 'gone',
      dueDate: '2020-01-01',
      dueMinutes: 0,
      doneAt: null,
      googleEventId: 'evt-3',
      syncStatus: 'synced',
      syncError: null,
      notifiedAt: null,
    });
    const { result } = renderHook(() => useDeleteReminderMutation(), { wrapper: wrapper() });
    await result.current.mutateAsync('r-del');
    await waitFor(() => expect(opsOf('deleteReminderEvent')).toHaveLength(1));
    expect(await db.reminders.get('r-del')).toBeUndefined();
  });
});
