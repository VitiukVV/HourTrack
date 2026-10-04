import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@/lib/db';

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>();
  return {
    ...actual,
    createEntry: vi.fn(() => Promise.reject(new Error('disk full'))),
    deleteEntry: vi.fn(() => Promise.reject(new Error('disk full'))),
    deleteReminder: vi.fn(() => Promise.reject(new Error('disk full'))),
  };
});
vi.mock('@/features/sync/SyncManager', () => ({
  getSyncManager: () => ({ enqueue: () => Promise.resolve() }),
}));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (msg: string) => toastError(msg) } }));

import i18n from '@/lib/i18n/i18n';
import { useDeleteReminderMutation } from '@/features/reminders/useReminders';

import { useCreateEntryMutation, useDeleteEntryMutation } from './useEntries';

/**
 * Spec 009 — failures are reported by the hook, not by each call: a per-call
 * `onError` runs only for the LAST `mutate` on the observer, so two quick taps
 * that both failed used to toast once (or, for the first, never).
 */

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
  toastError.mockClear();
});

const newEntry = (id: string) => ({
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
});

describe('hook-level write failures', () => {
  it('toasts every failed create, not just the last one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useCreateEntryMutation(), { wrapper });

    act(() => {
      result.current.mutate(newEntry('a'));
      result.current.mutate(newEntry('b'));
    });

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
    expect(toastError).toHaveBeenCalledWith(i18n.t('entries.saveFailed'));
  });

  it('toasts a failed entry delete', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useDeleteEntryMutation(), { wrapper });
    act(() => result.current.mutate('a'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(i18n.t('entries.deleteFailed')));
  });

  it('toasts a failed reminder delete', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useDeleteReminderMutation(), { wrapper });
    act(() => result.current.mutate('r1'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(i18n.t('reminders.actionFailed')));
  });
});
