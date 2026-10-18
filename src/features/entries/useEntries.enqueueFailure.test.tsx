import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';

const enqueue = vi.fn();
vi.mock('@/features/sync/SyncManager', () => ({ getSyncManager: () => ({ enqueue }) }));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

import { useCreateEntryMutation, useUpdateEntryMutation } from './useEntries';

/**
 * Spec 009 — a Calendar op that never reached the queue would leave the entry
 * `pending` forever with nothing to sync it. It is marked `error` instead, so
 * the editor offers "retry sync", and the user is told.
 */

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  await db.entries.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('useCreateEntryMutation — enqueue failure', () => {
  it('marks the new entry unsynced and toasts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    failOnly('createCalendarEvent');
    const { result } = renderHook(() => useCreateEntryMutation(), { wrapper });

    await result.current.mutateAsync(newEntry('e1'));

    await waitFor(async () => expect((await db.entries.get('e1'))?.syncStatus).toBe('error'));
    expect((await db.entries.get('e1'))?.syncError).toBe('quota');
    expect(toastError).toHaveBeenCalled();
  });

  it('marks an edited entry unsynced when its Calendar update is lost', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result: create } = renderHook(() => useCreateEntryMutation(), { wrapper });
    enqueue.mockResolvedValue(undefined);
    await create.current.mutateAsync({ ...newEntry('e2'), syncStatus: 'synced' });

    failOnly('updateCalendarEvent');
    const { result } = renderHook(() => useUpdateEntryMutation(), { wrapper });
    await result.current.mutateAsync({ id: 'e2', patch: { durationMin: 90 } });

    await waitFor(async () => expect((await db.entries.get('e2'))?.syncStatus).toBe('error'));
  });

  it('a lost Drive push toasts but leaves the Calendar state alone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    failOnly('pushDataJson');
    const { result } = renderHook(() => useCreateEntryMutation(), { wrapper });
    await result.current.mutateAsync(newEntry('e3'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect((await db.entries.get('e3'))?.syncStatus).toBe('pending');
  });
});

function failOnly(op: string) {
  enqueue.mockImplementation((o: { op: string }) =>
    o.op === op ? Promise.reject(new Error('quota')) : Promise.resolve(),
  );
}

function newEntry(id: string) {
  return {
    id,
    cardId: 'c1',
    date: '2026-05-14',
    startMinutes: 540,
    durationMin: 60,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending' as const,
    syncError: null,
  };
}
