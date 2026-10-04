import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, createEntry, initDB } from '@/lib/db';
import { applySnapshot, buildSnapshot } from '@/lib/sync/snapshot';
import type { Card, Entry } from '@hourtrack/shared-types';

import {
  useCreateEntryMutation,
  useDeleteEntryMutation,
  useEntriesByDateQuery,
  useEntryByIdQuery,
  useUpdateEntryMutation,
} from './useEntries';
import { useEntriesInRange } from './useEntriesInRange';

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
    position: 0,
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
  it('creates an entry and the mounted day list shows it', async () => {
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
  it('updates an entry and the mounted day list shows the change', async () => {
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

  // Regression: moving an entry to another day once left it listed on the OLD
  // day (only the destination's cache was invalidated).
  it('drops the entry from the ORIGINAL day list when its date changes', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Move' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    const W = wrapper();
    const oldDay = renderHook(() => useEntriesByDateQuery('2026-05-14'), { wrapper: W });
    const newDay = renderHook(() => useEntriesByDateQuery('2026-05-21'), { wrapper: W });
    const update = renderHook(() => useUpdateEntryMutation(), { wrapper: W });

    await waitFor(() => expect(oldDay.result.current.data).toHaveLength(1));

    await act(async () => {
      await update.result.current.mutateAsync({ id: entry.id, patch: { date: '2026-05-21' } });
    });

    await waitFor(() => {
      expect(oldDay.result.current.data).toHaveLength(0);
      expect(newDay.result.current.data).toHaveLength(1);
    });
  });

  // Regression: the S17 EntryEditModal reopens via `useEntryByIdQuery`; it once
  // served the pre-edit row, so RHF seeded the form with stale values.
  it('the by-id read sees the saved values, so a reopened edit modal is fresh', async () => {
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
  it('deletes an entry by id and the mounted day list drops it', async () => {
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
 * Spec 006 — the calendar range read is live, so it replaces the S23 surgical
 * cache patcher. What the patcher guaranteed still has to hold, now for every
 * write (a form save, a sync pull, a Calendar stamp):
 *   - S32: rows sit in display order in BOTH the date and the card buckets
 *     (`dayClickAction` deletes the first entry of the card bucket);
 *   - S23: a write leaves untouched day buckets and `cardsById` referentially
 *     identical, so `memo(DayCell)` skips those days;
 *   - a date move inside the range leaves the old day and lands on the new one.
 */
describe('useEntriesInRange — live calendar range', () => {
  const ANCHOR = '2026-05-14'; // week of Mon 2026-05-11 … Sun 2026-05-17

  async function mountWeek() {
    const W = wrapper();
    const range = renderHook(() => useEntriesInRange({ mode: 'week', anchorDate: ANCHOR }), {
      wrapper: W,
    });
    await waitFor(() => expect(range.result.current.isSuccess).toBe(true));
    return { range, W };
  }

  it('a new entry lands at its chronological position in the date and card buckets', async () => {
    const card = await createCard(testDb, makeCardInput());
    await createEntry(testDb, makeEntryInput(card.id, ANCHOR, { id: 'nine', startMinutes: 540 }));
    await createEntry(testDb, makeEntryInput(card.id, ANCHOR, { id: 'noon', startMinutes: 720 }));
    const { range, W } = await mountWeek();
    const create = renderHook(() => useCreateEntryMutation(), { wrapper: W });

    await act(async () => {
      await create.result.current.mutateAsync(
        makeEntryInput(card.id, ANCHOR, { id: 'eight', startMinutes: 480 }),
      );
    });

    await waitFor(() => {
      const data = range.result.current.data!;
      expect(data.entriesByDate.get(ANCHOR)?.map((e) => e.id)).toEqual(['eight', 'nine', 'noon']);
      expect(data.entriesByCard.get(card.id)?.map((e) => e.id)).toEqual(['eight', 'nine', 'noon']);
    });
  });

  it('keeps untouched day buckets and cardsById identical across a write (S23 memo)', async () => {
    const card = await createCard(testDb, makeCardInput());
    const edited = await createEntry(testDb, makeEntryInput(card.id, ANCHOR));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-15'));
    const { range, W } = await mountWeek();
    const before = range.result.current.data!;
    const update = renderHook(() => useUpdateEntryMutation(), { wrapper: W });

    await act(async () => {
      await update.result.current.mutateAsync({ id: edited.id, patch: { durationMin: 45 } });
    });

    await waitFor(() =>
      expect(range.result.current.data!.entriesByDate.get(ANCHOR)?.[0]?.durationMin).toBe(45),
    );
    const after = range.result.current.data!;
    expect(after.entriesByDate.get(ANCHOR)).not.toBe(before.entriesByDate.get(ANCHOR));
    expect(after.entriesByDate.get('2026-05-15')).toBe(before.entriesByDate.get('2026-05-15'));
    expect(after.cardsById).toBe(before.cardsById);
  });

  it('a date move inside the range leaves the old day and lands on the new one', async () => {
    const card = await createCard(testDb, makeCardInput());
    const entry = await createEntry(testDb, makeEntryInput(card.id, ANCHOR));
    const { range, W } = await mountWeek();
    const update = renderHook(() => useUpdateEntryMutation(), { wrapper: W });

    await act(async () => {
      await update.result.current.mutateAsync({ id: entry.id, patch: { date: '2026-05-16' } });
    });

    await waitFor(() => {
      const data = range.result.current.data!;
      expect(data.entriesByDate.get(ANCHOR)).toBeUndefined();
      expect(data.entriesByDate.get('2026-05-16')?.map((e) => e.id)).toEqual([entry.id]);
    });
  });

  it('follows a write made outside any hook (e.g. a sync pull)', async () => {
    const card = await createCard(testDb, makeCardInput());
    const { range } = await mountWeek();

    await act(() => createEntry(testDb, makeEntryInput(card.id, ANCHOR, { id: 'pulled' })));

    await waitFor(() =>
      expect(range.result.current.data!.entriesByDate.get(ANCHOR)?.map((e) => e.id)).toEqual([
        'pulled',
      ]),
    );
  });
});

// Spec 006 — a Drive pull reaches the calendar through Dexie alone (the old
// snapshot-applied event bus is gone). Both apply modes: the merge pull and
// the restore rewrite.
describe('useEntriesInRange — a sync pull reaches the mounted calendar', () => {
  const DAY = '2026-05-14';

  it.each(['merge', 'replace'] as const)('%s-mode applySnapshot', async (mode) => {
    const card = await createCard(testDb, makeCardInput());
    const doomed = await createEntry(testDb, makeEntryInput(card.id, DAY, { id: 'doomed' }));
    const range = renderHook(() => useEntriesInRange({ mode: 'week', anchorDate: DAY }), {
      wrapper: wrapper(),
    });
    await waitFor(() =>
      expect(range.result.current.data?.entriesByDate.get(DAY)?.map((e) => e.id)).toEqual([
        'doomed',
      ]),
    );

    const snap = await buildSnapshot(testDb);
    snap.entries = [{ ...doomed, id: 'pulled' }];
    // Merge keeps local rows unless a newer tombstone says otherwise.
    if (mode === 'merge') {
      snap.tombstones = [
        { entityType: 'entry', entityId: 'doomed', deletedAt: '2099-01-01T00:00:00.000Z' },
      ];
    }
    await act(async () => {
      await applySnapshot(snap, testDb, { mode });
    });

    await waitFor(() =>
      expect(range.result.current.data?.entriesByDate.get(DAY)?.map((e) => e.id)).toEqual([
        'pulled',
      ]),
    );
  });
});
