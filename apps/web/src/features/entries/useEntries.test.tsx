import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, createEntry, initDB } from '@/lib/db';
import type { Card, Entry } from '@hourtrack/shared-types';
import type { EntriesInRangeData } from '@/features/calendar/useEntriesInRange';

import {
  patchEntryInRangeCaches,
  useCreateEntryMutation,
  useDeleteEntryMutation,
  useEntriesByDateQuery,
  useEntryByIdQuery,
  useUpdateEntryMutation,
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
    color: '#2563EB',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    monthlyTotal: null,
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
    startMinutes: 600,
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

describe('useUpdateEntryMutation', () => {
  it('updates an entry and invalidates the day list query', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'U' }));
    const entry = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { durationMin: 60 }),
    );

    const W = wrapper();
    const list = renderHook(() => useEntriesByDateQuery('2026-05-14'), { wrapper: W });
    const update = renderHook(() => useUpdateEntryMutation(), { wrapper: W });

    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(list.result.current.data?.[0]?.durationMin).toBe(60);

    await act(async () => {
      await update.result.current.mutateAsync({
        id: entry.id,
        patch: { durationMin: 180, note: 'edited' },
      });
    });

    await waitFor(() => {
      const fresh = list.result.current.data?.[0];
      expect(fresh?.durationMin).toBe(180);
      expect(fresh?.note).toBe('edited');
    });
  });

  // Regression: the S17 EntryEditModal reopens via `useEntryByIdQuery`, which
  // is NOT covered by the range / by-date / by-card invalidations. Without the
  // by-id cache write inside `useUpdateEntryMutation.onSuccess`, a user who
  // reopens the modal right after saving sees the pre-edit form values.
  it('updates the by-id cache so a reopened edit modal sees fresh values', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'B' }));
    const entry = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { durationMin: 60, note: 'before' }),
    );

    const W = wrapper();
    const byId = renderHook(() => useEntryByIdQuery(entry.id), { wrapper: W });
    const update = renderHook(() => useUpdateEntryMutation(), { wrapper: W });

    await waitFor(() => expect(byId.result.current.isSuccess).toBe(true));
    expect(byId.result.current.data?.note).toBe('before');

    await act(async () => {
      await update.result.current.mutateAsync({
        id: entry.id,
        patch: { note: 'after', durationMin: 180 },
      });
    });

    // The by-id cache must reflect the new values synchronously after save —
    // any subsequent mount of EntryEditor (RHF's defaultValues snapshot) will
    // read from this cache.
    await waitFor(() => {
      expect(byId.result.current.data?.note).toBe('after');
      expect(byId.result.current.data?.durationMin).toBe(180);
    });
  });

  it('propagates the error when updateEntry fails (unknown id)', async () => {
    const W = wrapper();
    const update = renderHook(() => useUpdateEntryMutation(), { wrapper: W });

    await expect(
      update.result.current.mutateAsync({ id: 'nope', patch: { durationMin: 120 } }),
    ).rejects.toThrow(/not found/);
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

/**
 * S23 Part C — surgical TanStack patches for `['entries', 'range', ...]`
 * calendar caches.
 *
 * The full integration story (a real `useEntriesInRange` query subscribed
 * to a fake-indexeddb backed DB) is exercised indirectly throughout the
 * codebase. These tests instead drive the patcher directly via a shared
 * `QueryClient` so we can:
 *
 *   1. Seed a calendar range cache by hand with a known
 *      `EntriesInRangeData` shape (matches what `useEntriesInRange.queryFn`
 *      returns).
 *   2. Run the three mutation hooks and assert the cache is updated in
 *      place WITHOUT a refetch.
 *   3. Verify untouched buckets keep their array reference (the contract
 *      `memo(DayCell)`'s comparator depends on).
 *   4. Cover the date-change case (May 14 → May 21): both the old date's
 *      bucket and the new date's bucket must update inside a single range.
 *   5. Cover the cross-range case (an out-of-range cache is left
 *      byte-identical to its pre-mutation value).
 *   6. Cover the Reports cache exception (Reports range keys with the
 *      `'reports'` discriminator at index 2 are INVALIDATED, not patched).
 */
describe('S23 surgical range-cache patches', () => {
  function makeRangeData(
    start: string,
    end: string,
    entries: Entry[],
    cards: Card[],
  ): EntriesInRangeData {
    const entriesByDate = new Map<string, Entry[]>();
    const entriesByCard = new Map<string, Entry[]>();
    for (const e of entries) {
      const db = entriesByDate.get(e.date);
      if (db) db.push(e);
      else entriesByDate.set(e.date, [e]);
      const cb = entriesByCard.get(e.cardId);
      if (cb) cb.push(e);
      else entriesByCard.set(e.cardId, [e]);
    }
    const cardsById = new Map<string, Card>();
    for (const c of cards) cardsById.set(c.id, c);
    return { start, end, entries, entriesByDate, entriesByCard, cardsById };
  }

  it('create: patches the in-range calendar cache without refetching', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'P' }));

    // Set up a shared QueryClient (not per-hook) so the cache seeded
    // below is visible to the mutation hook's `setQueriesData`.
    const qc = new QueryClient({
      defaultOptions: {
        // S23 — we set data directly without a subscriber. `gcTime: 0`
        // (the default in the rest of this file's tests) would garbage-
        // collect the cache value immediately because nothing keeps it
        // alive. The patch tests deliberately verify in-place updates,
        // so we hold the cache alive via `gcTime: Infinity` for the
        // duration of each test.
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const W = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    // Seed an empty May-2026 calendar range cache.
    qc.setQueryData(
      ['entries', 'range', '2026-04-27', '2026-05-31'],
      makeRangeData('2026-04-27', '2026-05-31', [], [card]),
    );

    const create = renderHook(() => useCreateEntryMutation(), { wrapper: W });

    const inputs = makeEntryInput(card.id, '2026-05-14', { durationMin: 90 });
    await act(async () => {
      await create.result.current.mutateAsync(inputs);
    });

    const cached = qc.getQueryData<EntriesInRangeData>([
      'entries',
      'range',
      '2026-04-27',
      '2026-05-31',
    ]);
    expect(cached).toBeTruthy();
    expect(cached!.entries).toHaveLength(1);
    expect(cached!.entries[0]!.durationMin).toBe(90);
    expect(cached!.entriesByDate.get('2026-05-14')).toHaveLength(1);
    expect(cached!.entriesByCard.get(card.id)).toHaveLength(1);
  });

  it('update: replaces entry shape; untouched date bucket keeps array identity', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'U' }));
    const e1 = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { durationMin: 60 }),
    );
    const e2 = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-15', { durationMin: 30 }),
    );

    const qc = new QueryClient({
      defaultOptions: {
        // S23 — we set data directly without a subscriber. `gcTime: 0`
        // (the default in the rest of this file's tests) would garbage-
        // collect the cache value immediately because nothing keeps it
        // alive. The patch tests deliberately verify in-place updates,
        // so we hold the cache alive via `gcTime: Infinity` for the
        // duration of each test.
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const W = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    qc.setQueryData(
      ['entries', 'range', '2026-04-27', '2026-05-31'],
      makeRangeData('2026-04-27', '2026-05-31', [e1, e2], [card]),
    );

    // Capture the May 15 bucket BEFORE the mutation.
    const before = qc.getQueryData<EntriesInRangeData>([
      'entries',
      'range',
      '2026-04-27',
      '2026-05-31',
    ]);
    const may15Before = before!.entriesByDate.get('2026-05-15');

    const update = renderHook(() => useUpdateEntryMutation(), { wrapper: W });
    await act(async () => {
      await update.result.current.mutateAsync({
        id: e1.id,
        patch: { durationMin: 240 },
      });
    });

    const after = qc.getQueryData<EntriesInRangeData>([
      'entries',
      'range',
      '2026-04-27',
      '2026-05-31',
    ]);
    // May 14 bucket has the updated duration.
    const may14After = after!.entriesByDate.get('2026-05-14');
    expect(may14After).toHaveLength(1);
    expect(may14After![0]!.durationMin).toBe(240);
    // May 15 bucket: SAME ARRAY REFERENCE — untouched.
    const may15After = after!.entriesByDate.get('2026-05-15');
    expect(may15After).toBe(may15Before);
  });

  it('update: date change (May 14 → May 21) removes from old bucket, inserts at new', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'M' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    const qc = new QueryClient({
      defaultOptions: {
        // S23 — we set data directly without a subscriber. `gcTime: 0`
        // (the default in the rest of this file's tests) would garbage-
        // collect the cache value immediately because nothing keeps it
        // alive. The patch tests deliberately verify in-place updates,
        // so we hold the cache alive via `gcTime: Infinity` for the
        // duration of each test.
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const W = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    qc.setQueryData(
      ['entries', 'range', '2026-04-27', '2026-05-31'],
      makeRangeData('2026-04-27', '2026-05-31', [entry], [card]),
    );

    const update = renderHook(() => useUpdateEntryMutation(), { wrapper: W });
    await act(async () => {
      await update.result.current.mutateAsync({
        id: entry.id,
        patch: { date: '2026-05-21' },
      });
    });

    const cached = qc.getQueryData<EntriesInRangeData>([
      'entries',
      'range',
      '2026-04-27',
      '2026-05-31',
    ]);
    expect(cached!.entriesByDate.get('2026-05-14')).toBeUndefined();
    const may21 = cached!.entriesByDate.get('2026-05-21');
    expect(may21).toHaveLength(1);
    expect(may21![0]!.id).toBe(entry.id);
    expect(cached!.entries).toHaveLength(1);
  });

  it('delete: removes entry from buckets; other dates untouched', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'D' }));
    const e1 = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));
    const e2 = await createEntry(testDb, makeEntryInput(card.id, '2026-05-15'));

    const qc = new QueryClient({
      defaultOptions: {
        // S23 — we set data directly without a subscriber. `gcTime: 0`
        // (the default in the rest of this file's tests) would garbage-
        // collect the cache value immediately because nothing keeps it
        // alive. The patch tests deliberately verify in-place updates,
        // so we hold the cache alive via `gcTime: Infinity` for the
        // duration of each test.
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const W = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    qc.setQueryData(
      ['entries', 'range', '2026-04-27', '2026-05-31'],
      makeRangeData('2026-04-27', '2026-05-31', [e1, e2], [card]),
    );

    const before = qc.getQueryData<EntriesInRangeData>([
      'entries',
      'range',
      '2026-04-27',
      '2026-05-31',
    ]);
    const may15Before = before!.entriesByDate.get('2026-05-15');

    const del = renderHook(() => useDeleteEntryMutation(), { wrapper: W });
    await act(async () => {
      await del.result.current.mutateAsync(e1.id);
    });

    const after = qc.getQueryData<EntriesInRangeData>([
      'entries',
      'range',
      '2026-04-27',
      '2026-05-31',
    ]);
    expect(after!.entries).toHaveLength(1);
    expect(after!.entriesByDate.get('2026-05-14')).toBeUndefined();
    // May 15 bucket: same reference.
    expect(after!.entriesByDate.get('2026-05-15')).toBe(may15Before);
  });

  it('out-of-range cache is left untouched (same reference)', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'X' }));

    const qc = new QueryClient({
      defaultOptions: {
        // S23 — we set data directly without a subscriber. `gcTime: 0`
        // (the default in the rest of this file's tests) would garbage-
        // collect the cache value immediately because nothing keeps it
        // alive. The patch tests deliberately verify in-place updates,
        // so we hold the cache alive via `gcTime: Infinity` for the
        // duration of each test.
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const W = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    // June 2026 cache — does NOT overlap with the May 14 create below.
    const juneSeed = makeRangeData('2026-06-01', '2026-06-30', [], [card]);
    qc.setQueryData(['entries', 'range', '2026-06-01', '2026-06-30'], juneSeed);

    const create = renderHook(() => useCreateEntryMutation(), { wrapper: W });
    await act(async () => {
      await create.result.current.mutateAsync(
        makeEntryInput(card.id, '2026-05-14', { durationMin: 60 }),
      );
    });

    // June cache must be the SAME object reference (no patch, no
    // invalidation triggered because the date falls outside).
    const juneAfter = qc.getQueryData(['entries', 'range', '2026-06-01', '2026-06-30']);
    expect(juneAfter).toBe(juneSeed);
  });

  it('Reports range cache is invalidated, not patched', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'R' }));

    const qc = new QueryClient({
      defaultOptions: {
        // S23 — we set data directly without a subscriber. `gcTime: 0`
        // (the default in the rest of this file's tests) would garbage-
        // collect the cache value immediately because nothing keeps it
        // alive. The patch tests deliberately verify in-place updates,
        // so we hold the cache alive via `gcTime: Infinity` for the
        // duration of each test.
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const W = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    // Reports-shaped cached value (just a sentinel — we only care that
    // the key gets invalidated, not what's inside).
    const reportsSentinel = { __reports: true };
    qc.setQueryData(
      ['entries', 'range', 'reports', '2026-05-01', '2026-05-31', false, 'all'],
      reportsSentinel,
    );
    // Also seed a calendar range cache so we can confirm the calendar
    // path still patches normally.
    qc.setQueryData(
      ['entries', 'range', '2026-04-27', '2026-05-31'],
      makeRangeData('2026-04-27', '2026-05-31', [], [card]),
    );

    const create = renderHook(() => useCreateEntryMutation(), { wrapper: W });
    await act(async () => {
      await create.result.current.mutateAsync(
        makeEntryInput(card.id, '2026-05-14', { durationMin: 60 }),
      );
    });

    // The Reports cache must be marked stale (refetch on next subscriber).
    const reportsState = qc.getQueryState([
      'entries',
      'range',
      'reports',
      '2026-05-01',
      '2026-05-31',
      false,
      'all',
    ]);
    expect(reportsState?.isInvalidated).toBe(true);

    // The calendar cache got the create patched in.
    const calendarCache = qc.getQueryData<EntriesInRangeData>([
      'entries',
      'range',
      '2026-04-27',
      '2026-05-31',
    ]);
    expect(calendarCache!.entries).toHaveLength(1);
  });
});

describe('S32 ordering inside the optimistic range-cache patch', () => {
  const START = '2026-04-27';
  const END = '2026-05-31';
  const DAY = '2026-05-14';
  const CARD = 'card-s32';
  const STAMP = '2026-05-01T00:00:00.000Z';

  function entryAt(id: string, startMinutes: number, date = DAY): Entry {
    return {
      id,
      cardId: CARD,
      date,
      startMinutes,
      durationMin: 60,
      useCustomPayment: false,
      customPayment: null,
      note: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    };
  }

  function seedCache(entries: Entry[]): QueryClient {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const entriesByDate = new Map<string, Entry[]>();
    const entriesByCard = new Map<string, Entry[]>();
    for (const e of entries) {
      entriesByDate.set(e.date, [...(entriesByDate.get(e.date) ?? []), e]);
      entriesByCard.set(e.cardId, [...(entriesByCard.get(e.cardId) ?? []), e]);
    }
    qc.setQueryData(['entries', 'range', START, END], {
      start: START,
      end: END,
      entries,
      entriesByDate,
      entriesByCard,
      cardsById: new Map<string, Card>(),
    } satisfies EntriesInRangeData);
    return qc;
  }

  function read(qc: QueryClient): EntriesInRangeData {
    return qc.getQueryData<EntriesInRangeData>(['entries', 'range', START, END])!;
  }

  it('create: a new entry lands at its chronological position, not at the end', () => {
    const qc = seedCache([entryAt('ten', 600), entryAt('twelve', 720)]);

    patchEntryInRangeCaches(qc, entryAt('eight', 480), 'create');

    const cached = read(qc);
    expect(cached.entriesByDate.get(DAY)!.map((e) => e.id)).toEqual(['eight', 'ten', 'twelve']);
  });

  it('update: moving the middle entry later re-sorts the whole day', () => {
    const qc = seedCache([entryAt('nine', 540), entryAt('eleven', 660), entryAt('two', 840)]);

    patchEntryInRangeCaches(qc, entryAt('eleven', 960), 'update');

    const cached = read(qc);
    expect(cached.entriesByDate.get(DAY)!.map((e) => e.id)).toEqual(['nine', 'two', 'eleven']);
  });

  it('update: moving the middle entry earlier re-sorts the whole day', () => {
    const qc = seedCache([entryAt('nine', 540), entryAt('eleven', 660), entryAt('two', 840)]);

    patchEntryInRangeCaches(qc, entryAt('eleven', 360), 'update');

    const cached = read(qc);
    expect(cached.entriesByDate.get(DAY)!.map((e) => e.id)).toEqual(['eleven', 'nine', 'two']);
  });

  it('orders the entriesByCard bucket too — dayClickAction deletes its first element', () => {
    const qc = seedCache([entryAt('eleven', 660)]);

    patchEntryInRangeCaches(qc, entryAt('nine', 540), 'create');

    const cached = read(qc);
    // A patched cache and a refetched one must agree about which entry the
    // day-cell click would delete.
    expect(cached.entriesByCard.get(CARD)!.map((e) => e.id)).toEqual(['nine', 'eleven']);
  });

  it('leaves untouched date buckets referentially identical (S23 memo contract)', () => {
    const otherDay = '2026-05-20';
    const qc = seedCache([entryAt('nine', 540), entryAt('elsewhere', 600, otherDay)]);
    const before = read(qc).entriesByDate.get(otherDay);

    patchEntryInRangeCaches(qc, entryAt('seven', 420), 'create');

    expect(read(qc).entriesByDate.get(otherDay)).toBe(before);
  });
});
