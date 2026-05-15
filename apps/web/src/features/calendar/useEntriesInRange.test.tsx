import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, createEntry, initDB } from '@/lib/db';
import type { Card, Entry } from '@hourtrack/shared-types';

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
    color: '#3B82F6',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
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
  testDb = new HourTrackDB(`hourtrack-entries-range-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('useEntriesInRange (month)', () => {
  it('returns entries inside the calendar grid range for the anchor month (Mon-Sun grid)', async () => {
    // May 2026: 1st is Fri; calendar grid starts Mon 27 Apr and ends Sun 31 May.
    const card = await createCard(testDb, makeCardInput({ name: 'In' }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-04-27')); // start of grid
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-14')); // inside month
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-31')); // end of grid
    await createEntry(testDb, makeEntryInput(card.id, '2026-04-26')); // out of grid
    await createEntry(testDb, makeEntryInput(card.id, '2026-06-01')); // out of grid

    const { result } = renderHook(
      () => useEntriesInRange({ mode: 'month', anchorDate: '2026-05-14' }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data!;
    expect(data.start).toBe('2026-04-27');
    expect(data.end).toBe('2026-05-31');
    expect(data.entries).toHaveLength(3);
    expect(data.entries.map((e) => e.date)).toEqual(['2026-04-27', '2026-05-14', '2026-05-31']);
  });

  it('builds an entriesByDate Map keyed by YYYY-MM-DD for O(1) per-cell lookup', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Two on a day' }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-15'));

    const { result } = renderHook(
      () => useEntriesInRange({ mode: 'month', anchorDate: '2026-05-14' }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const byDate = result.current.data!.entriesByDate;
    expect(byDate.get('2026-05-14')).toHaveLength(2);
    expect(byDate.get('2026-05-15')).toHaveLength(1);
    expect(byDate.get('2026-05-16')).toBeUndefined();
  });

  it('exposes a cardsById map for O(1) color/name lookup', async () => {
    const a = await createCard(testDb, makeCardInput({ name: 'A' }));
    const b = await createCard(testDb, makeCardInput({ name: 'B', color: '#EF4444' }));

    const { result } = renderHook(
      () => useEntriesInRange({ mode: 'month', anchorDate: '2026-05-14' }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const byId = result.current.data!.cardsById;
    expect(byId.get(a.id)?.name).toBe('A');
    expect(byId.get(b.id)?.color).toBe('#EF4444');
  });

  it('exposes an entriesByCard map keyed by cardId for O(1) per-card lookup (S04 W2 fix)', async () => {
    const a = await createCard(testDb, makeCardInput({ name: 'A' }));
    const b = await createCard(testDb, makeCardInput({ name: 'B' }));
    await createEntry(testDb, makeEntryInput(a.id, '2026-05-14'));
    await createEntry(testDb, makeEntryInput(a.id, '2026-05-15'));
    await createEntry(testDb, makeEntryInput(b.id, '2026-05-14'));

    const { result } = renderHook(
      () => useEntriesInRange({ mode: 'month', anchorDate: '2026-05-14' }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const byCard = result.current.data!.entriesByCard;
    expect(byCard.get(a.id)).toHaveLength(2);
    expect(byCard.get(b.id)).toHaveLength(1);
    expect(byCard.get('does-not-exist')).toBeUndefined();
  });

  it('refetches when anchorDate changes (different range = different query key)', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Across months' }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));
    await createEntry(testDb, makeEntryInput(card.id, '2026-06-14'));

    const { result, rerender } = renderHook(
      ({ anchor }: { anchor: string }) => useEntriesInRange({ mode: 'month', anchorDate: anchor }),
      { wrapper: wrapper(), initialProps: { anchor: '2026-05-14' } },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.entries.map((e) => e.date)).toEqual(['2026-05-14']);

    rerender({ anchor: '2026-06-14' });
    await waitFor(() =>
      expect(result.current.data?.entries.map((e) => e.date)).toEqual(['2026-06-14']),
    );
  });
});

describe('useEntriesInRange (week)', () => {
  it('returns Monday→Sunday range for the anchor week', async () => {
    // 2026-05-14 is a Thursday; week is Mon 11 May - Sun 17 May.
    const card = await createCard(testDb, makeCardInput({ name: 'W' }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-11')); // Mon
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-17')); // Sun
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-10')); // prev Sun, out
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-18')); // next Mon, out

    const { result } = renderHook(
      () => useEntriesInRange({ mode: 'week', anchorDate: '2026-05-14' }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    expect(data.start).toBe('2026-05-11');
    expect(data.end).toBe('2026-05-17');
    expect(data.entries.map((e) => e.date)).toEqual(['2026-05-11', '2026-05-17']);
  });

  it('week mode uses Monday start even when anchor is a Sunday', async () => {
    // 2026-05-17 is a Sunday; the Mon→Sun week containing it is still 11–17.
    const card = await createCard(testDb, makeCardInput({ name: 'Sun' }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-11'));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-17'));

    const { result } = renderHook(
      () => useEntriesInRange({ mode: 'week', anchorDate: '2026-05-17' }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.start).toBe('2026-05-11');
    expect(result.current.data!.end).toBe('2026-05-17');
  });
});
