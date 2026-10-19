import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card } from '@/shared/types';

import type * as dbModule from '@/lib/db';
import {
  HourTrackDB,
  createCard,
  createEntry,
  createPayment,
  deleteMonthAdjustment,
  initDB,
  setMonthAdjustment,
  updateEntry,
} from '@/lib/db';

import { useMonthLedger } from './usePayments';

let testDb: HourTrackDB;
type DbModule = typeof dbModule;

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<DbModule>();
  return {
    ...actual,
    get db() {
      return testDb;
    },
  };
});

function makeCard(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Card',
    color: '#2563EB',
    position: 0,
    defaultDurationMin: 60,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 10,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    ...overrides,
  };
}

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-ledger-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await testDb.delete();
});

// Spec 006 — the ledger composes live reads (spec 011 adds adjustments); a write to any of them
// recomputes it while /payments is open.
describe('useMonthLedger', () => {
  it('follows an entry edit and a new payment', async () => {
    const card = await createCard(testDb, makeCard());
    const entry = await createEntry(testDb, {
      id: 'e1',
      cardId: card.id,
      date: '2026-05-14',
      startMinutes: 600,
      durationMin: 60,
      useCustomPayment: false,
      customPayment: null,
      note: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
    });
    const { result } = renderHook(() => useMonthLedger('2026-05'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.totals.expected).toBe(10));

    await act(async () => {
      await updateEntry(testDb, entry.id, { durationMin: 120 });
    });
    await waitFor(() => expect(result.current.data?.totals.expected).toBe(20));

    await act(async () => {
      await createPayment(testDb, {
        id: 'p1',
        cardId: card.id,
        period: '2026-05',
        amount: 20,
        paidOn: '2026-06-01',
        note: null,
      });
    });
    await waitFor(() => expect(result.current.data?.totals.received).toBe(20));
  });

  it('follows a month adjustment being set and reset', async () => {
    const card = await createCard(
      testDb,
      makeCard({ rateType: 'monthly', hourlyRate: null, monthlyTotal: 250 }),
    );
    await createEntry(testDb, {
      id: 'e1',
      cardId: card.id,
      date: '2026-05-14',
      startMinutes: 600,
      durationMin: 60,
      useCustomPayment: false,
      customPayment: null,
      note: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
    });
    const { result } = renderHook(() => useMonthLedger('2026-05'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.totals.expected).toBe(250));

    let id = '';
    await act(async () => {
      id = (await setMonthAdjustment(testDb, { cardId: card.id, period: '2026-05', amount: 200 }))
        .id;
    });
    await waitFor(() =>
      expect(result.current.data?.rows[0]).toMatchObject({ expected: 200, adjusted: true }),
    );

    await act(async () => {
      await deleteMonthAdjustment(testDb, id);
    });
    await waitFor(() =>
      expect(result.current.data?.rows[0]).toMatchObject({ expected: 250, adjusted: false }),
    );
  });

  it('reports an error when one of its reads fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(await import('@/lib/db'), 'getEntriesByDateRange').mockRejectedValue(
      new Error('read failed'),
    );

    const { result } = renderHook(() => useMonthLedger('2026-05'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
