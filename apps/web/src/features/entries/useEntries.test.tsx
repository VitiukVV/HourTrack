import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, createEntry, initDB } from '@/lib/db';
import type { Card, Entry } from '@hourtrack/shared-types';

import {
  useCreateEntryMutation,
  useDeleteEntryMutation,
  useEntriesByDateQuery,
} from './useEntries';

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

function makeCardInput(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Card',
    color: '#3B82F6',
    defaultDurationMin: 480,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    ...overrides,
  };
}

function makeEntryInput(
  cardId: string,
  date: string,
  overrides: Partial<Entry> = {},
): Omit<Entry, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    cardId,
    date,
    durationMin: 120,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    ...overrides,
  };
}

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-entries-hooks-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('useEntriesByDateQuery', () => {
  it('returns entries for the given date and refetches on creation', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Q' }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    const W = wrapper();
    const { result } = renderHook(() => useEntriesByDateQuery('2026-05-14'), { wrapper: W });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });
});

describe('useCreateEntryMutation', () => {
  it('creates an entry and invalidates ["entries"] queries so day list refreshes', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'C' }));

    const W = wrapper();
    const list = renderHook(() => useEntriesByDateQuery('2026-05-14'), { wrapper: W });
    const create = renderHook(() => useCreateEntryMutation(), { wrapper: W });

    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(list.result.current.data).toHaveLength(0);

    await act(async () => {
      await create.result.current.mutateAsync(
        makeEntryInput(card.id, '2026-05-14', { durationMin: 90 }),
      );
    });

    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    expect(list.result.current.data?.[0]?.durationMin).toBe(90);
  });
});

describe('useDeleteEntryMutation', () => {
  it('deletes an entry by id and invalidates the day list', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'D' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    const W = wrapper();
    const list = renderHook(() => useEntriesByDateQuery('2026-05-14'), { wrapper: W });
    const del = renderHook(() => useDeleteEntryMutation(), { wrapper: W });

    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(list.result.current.data).toHaveLength(1);

    await act(async () => {
      await del.result.current.mutateAsync(entry.id);
    });

    await waitFor(() => expect(list.result.current.data).toHaveLength(0));
  });
});
