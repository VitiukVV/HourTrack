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

import { useCreateEntryMutation } from './useEntries';

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
    enqueue.mockRejectedValue(new Error('quota'));
    const { result } = renderHook(() => useCreateEntryMutation(), { wrapper });

    await result.current.mutateAsync({
      id: 'e1',
      cardId: 'c1',
      date: '2026-05-14',
      startMinutes: 540,
      durationMin: 60,
      useCustomPayment: false,
      customPayment: null,
      note: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
    });

    await waitFor(async () => expect((await db.entries.get('e1'))?.syncStatus).toBe('error'));
    expect((await db.entries.get('e1'))?.syncError).toBe('quota');
    expect(toastError).toHaveBeenCalled();
  });
});
