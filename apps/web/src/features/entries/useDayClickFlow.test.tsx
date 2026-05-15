import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, createEntry, initDB } from '@/lib/db';
import type { Card, Entry } from '@hourtrack/shared-types';

import { useActiveCardStore } from '@/features/cards/useActiveCardStore';

import { useDayClickFlow } from './useDayClickFlow';

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
  testDb = new HourTrackDB(`hourtrack-day-flow-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
  useActiveCardStore.getState().clearActive();
});

afterEach(async () => {
  await testDb.delete();
  useActiveCardStore.getState().clearActive();
});

describe('useDayClickFlow', () => {
  it('starts with no pickerDate and no pendingDelete', () => {
    const W = wrapper();
    const cardsById = new Map<string, Card>();
    const entriesByCard = new Map<string, Entry[]>();
    const { result } = renderHook(() => useDayClickFlow({ cardsById, entriesByCard }), {
      wrapper: W,
    });

    expect(result.current.pickerDate).toBeNull();
    expect(result.current.pendingDelete).toBeNull();
  });

  it('handleDayClick with no active card sets pickerDate', () => {
    const W = wrapper();
    const cardsById = new Map<string, Card>();
    const entriesByCard = new Map<string, Entry[]>();
    const { result } = renderHook(() => useDayClickFlow({ cardsById, entriesByCard }), {
      wrapper: W,
    });

    act(() => {
      result.current.handleDayClick('2026-05-14');
    });

    expect(result.current.pickerDate).toBe('2026-05-14');
  });

  it('handleDayClick with active card + no existing entry creates an entry', async () => {
    const card = await createCard(testDb, makeCardInput({ defaultDurationMin: 90 }));
    useActiveCardStore.getState().setActiveCardId(card.id);

    const W = wrapper();
    const cardsById = new Map<string, Card>([[card.id, card]]);
    const entriesByCard = new Map<string, Entry[]>();
    const { result } = renderHook(() => useDayClickFlow({ cardsById, entriesByCard }), {
      wrapper: W,
    });

    await act(async () => {
      result.current.handleDayClick('2026-05-14');
    });

    await waitFor(async () => {
      const entries = await testDb.entries.toArray();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.durationMin).toBe(90);
      expect(entries[0]?.date).toBe('2026-05-14');
    });
  });

  it('handleDayClick with active card + existing entry on date sets pendingDelete', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Del' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));
    useActiveCardStore.getState().setActiveCardId(card.id);

    const W = wrapper();
    const cardsById = new Map<string, Card>([[card.id, card]]);
    const entriesByCard = new Map<string, Entry[]>([[card.id, [entry]]]);
    const { result } = renderHook(() => useDayClickFlow({ cardsById, entriesByCard }), {
      wrapper: W,
    });

    act(() => {
      result.current.handleDayClick('2026-05-14');
    });

    expect(result.current.pendingDelete).not.toBeNull();
    expect(result.current.pendingDelete?.entry.id).toBe(entry.id);
  });

  it('closePicker clears pickerDate', () => {
    const W = wrapper();
    const cardsById = new Map<string, Card>();
    const entriesByCard = new Map<string, Entry[]>();
    const { result } = renderHook(() => useDayClickFlow({ cardsById, entriesByCard }), {
      wrapper: W,
    });

    act(() => {
      result.current.handleDayClick('2026-05-14');
    });
    expect(result.current.pickerDate).toBe('2026-05-14');

    act(() => {
      result.current.closePicker();
    });
    expect(result.current.pickerDate).toBeNull();
  });

  it('closeDelete clears pendingDelete', async () => {
    const card = await createCard(testDb, makeCardInput());
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));
    useActiveCardStore.getState().setActiveCardId(card.id);

    const W = wrapper();
    const cardsById = new Map<string, Card>([[card.id, card]]);
    const entriesByCard = new Map<string, Entry[]>([[card.id, [entry]]]);
    const { result } = renderHook(() => useDayClickFlow({ cardsById, entriesByCard }), {
      wrapper: W,
    });

    act(() => {
      result.current.handleDayClick('2026-05-14');
    });
    expect(result.current.pendingDelete).not.toBeNull();

    act(() => {
      result.current.closeDelete();
    });
    expect(result.current.pendingDelete).toBeNull();
  });

  it('createEntryForCardOnDate persists an entry with card defaults', async () => {
    const card = await createCard(
      testDb,
      makeCardInput({
        defaultDurationMin: 150,
        defaultNote: 'Stand-up',
      }),
    );

    const W = wrapper();
    const cardsById = new Map<string, Card>([[card.id, card]]);
    const entriesByCard = new Map<string, Entry[]>();
    const { result } = renderHook(() => useDayClickFlow({ cardsById, entriesByCard }), {
      wrapper: W,
    });

    await act(async () => {
      result.current.createEntryForCardOnDate(card, '2026-05-15');
    });

    await waitFor(async () => {
      const all = await testDb.entries.toArray();
      expect(all).toHaveLength(1);
      expect(all[0]?.durationMin).toBe(150);
      expect(all[0]?.note).toBe('Stand-up');
    });
  });

  it('confirmDelete deletes the pending entry from DB', async () => {
    const card = await createCard(testDb, makeCardInput());
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));
    useActiveCardStore.getState().setActiveCardId(card.id);

    const W = wrapper();
    const cardsById = new Map<string, Card>([[card.id, card]]);
    const entriesByCard = new Map<string, Entry[]>([[card.id, [entry]]]);
    const { result } = renderHook(() => useDayClickFlow({ cardsById, entriesByCard }), {
      wrapper: W,
    });

    act(() => {
      result.current.handleDayClick('2026-05-14');
    });

    await act(async () => {
      result.current.confirmDelete();
    });

    await waitFor(async () => {
      const gone = await testDb.entries.get(entry.id);
      expect(gone).toBeUndefined();
    });
  });
});
