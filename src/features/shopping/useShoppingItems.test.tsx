import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (msg: string) => toastError(msg) } }));

const enqueue = vi.fn((_op: { op: string; mutation?: string }) => Promise.resolve());

vi.mock('@/features/sync/SyncManager', () => ({
  getSyncManager: () => ({ enqueue }),
}));

import {
  useAddShoppingItemMutation,
  useDeleteShoppingItemMutation,
  useShoppingItems,
  useToggleShoppingItemBoughtMutation,
  useUpdateShoppingItemTextMutation,
} from './useShoppingItems';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(async () => {
  enqueue.mockClear();
  toastError.mockClear();
  await db.shoppingItems.clear();
  await db.tombstones.clear();
});

describe('shopping list hooks (spec 015)', () => {
  it('every write schedules one Drive push and the live read follows', async () => {
    const list = renderHook(() => useShoppingItems(), { wrapper: wrapper() });
    const add = renderHook(() => useAddShoppingItemMutation(), { wrapper: wrapper() });
    const edit = renderHook(() => useUpdateShoppingItemTextMutation(), { wrapper: wrapper() });
    const toggle = renderHook(() => useToggleShoppingItemBoughtMutation(), { wrapper: wrapper() });
    const del = renderHook(() => useDeleteShoppingItemMutation(), { wrapper: wrapper() });

    const row = await add.result.current.mutateAsync({
      cardId: 'c1',
      text: 'Bags',
      period: '2026-10',
    });
    await waitFor(() => expect(list.result.current.data).toEqual([row]));

    await edit.result.current.mutateAsync({ id: row.id, text: 'White bags' });
    await toggle.result.current.mutateAsync({ id: row.id, bought: true, period: '2026-10' });
    await waitFor(() => {
      expect(list.result.current.data?.[0]).toMatchObject({ text: 'White bags' });
      expect(list.result.current.data?.[0]?.boughtPeriod).not.toBeNull();
    });

    await del.result.current.mutateAsync(row.id);
    await waitFor(() => expect(list.result.current.data).toEqual([]));

    expect(enqueue.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ op: 'pushDataJson', mutation: 'create' }),
      expect.objectContaining({ op: 'pushDataJson', mutation: 'update' }),
      expect.objectContaining({ op: 'pushDataJson', mutation: 'update' }),
      expect.objectContaining({ op: 'pushDataJson', mutation: 'delete' }),
    ]);
  });

  it('a rejected write schedules no push', async () => {
    const add = renderHook(() => useAddShoppingItemMutation(), { wrapper: wrapper() });
    await expect(
      add.result.current.mutateAsync({ cardId: 'c1', text: '  ', period: '2026-10' }),
    ).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('a failed write is logged and toasted by the hook itself', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const toggle = renderHook(() => useToggleShoppingItemBoughtMutation(), { wrapper: wrapper() });
    toggle.result.current.mutate({ id: 'missing', bought: true, period: '2026-10' });
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('[useShoppingItems]'),
      expect.any(Error),
    );
    error.mockRestore();
  });

  it('adds and ticks into the month passed in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 3, 9, 0));
    const add = renderHook(() => useAddShoppingItemMutation(), { wrapper: wrapper() });
    const toggle = renderHook(() => useToggleShoppingItemBoughtMutation(), { wrapper: wrapper() });
    const row = await add.result.current.mutateAsync({
      cardId: 'c1',
      text: 'Bags',
      period: '2026-09',
    });
    const ticked = await toggle.result.current.mutateAsync({
      id: row.id,
      bought: true,
      period: '2026-10',
    });
    vi.useRealTimers();
    expect(row.addedPeriod).toBe('2026-09');
    expect(ticked.boughtPeriod).toBe('2026-10');
  });
});
