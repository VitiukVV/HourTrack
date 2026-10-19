import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';

const enqueue = vi.fn((_op: { op: string; mutation?: string }) => Promise.resolve());

vi.mock('@/features/sync/SyncManager', () => ({
  getSyncManager: () => ({ enqueue }),
}));

import {
  useDeleteMonthAdjustmentMutation,
  useSetMonthAdjustmentMutation,
} from './useMonthAdjustments';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(async () => {
  enqueue.mockClear();
  await db.monthAdjustments.clear();
  await db.tombstones.clear();
});

describe('month adjustment mutations — Drive push (US3)', () => {
  it('set and reset each schedule one push', async () => {
    const set = renderHook(() => useSetMonthAdjustmentMutation(), { wrapper: wrapper() });
    const row = await set.result.current.mutateAsync({
      cardId: 'c1',
      period: '2026-10',
      amount: 200,
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]![0]).toMatchObject({ op: 'pushDataJson', mutation: 'update' });

    const del = renderHook(() => useDeleteMonthAdjustmentMutation(), { wrapper: wrapper() });
    await del.result.current.mutateAsync(row.id);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls[1]![0]).toMatchObject({ op: 'pushDataJson', mutation: 'delete' });
  });

  it('a rejected write schedules no push', async () => {
    const set = renderHook(() => useSetMonthAdjustmentMutation(), { wrapper: wrapper() });
    await expect(
      set.result.current.mutateAsync({ cardId: 'c1', period: '2026-10', amount: -1 }),
    ).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
