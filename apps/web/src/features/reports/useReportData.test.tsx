import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, createEntry, initDB } from '@/lib/db';

import { useReportData } from './useReportData';
import { useReportsFilters } from './reportsStore';

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
    durationMin: 60,
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
  testDb = new HourTrackDB(`hourtrack-report-data-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
  // Reset the filter store to defaults between tests so cases don't leak.
  useReportsFilters.getState().reset();
});

afterEach(async () => {
  await testDb.delete();
});

describe('useReportData', () => {
  it('loads entries for the month surrounding anchorDate and aggregates them', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Q', hourlyRate: 10 }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-14', { durationMin: 60 }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-15', { durationMin: 120 }));

    useReportsFilters.getState().setAnchorDate('2026-05-14');
    useReportsFilters.getState().setPeriod('month');

    const W = wrapper();
    const { result } = renderHook(() => useReportData(), { wrapper: W });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    expect(data.totals.durationMin).toBe(180);
    expect(data.totals.earnings).toBeCloseTo(30, 5);
    // byEntry flows through with one row per loaded entry
    expect(data.byEntry).toHaveLength(2);
    expect(data.byEntry.map((r) => r.entry.date)).toEqual(['2026-05-14', '2026-05-15']);
  });

  it('respects an explicit selectedCardIds filter and excludes other cards', async () => {
    const cardA = await createCard(testDb, makeCardInput({ name: 'A', hourlyRate: 10 }));
    const cardB = await createCard(testDb, makeCardInput({ name: 'B', hourlyRate: 20 }));
    await createEntry(testDb, makeEntryInput(cardA.id, '2026-05-14', { durationMin: 60 }));
    await createEntry(testDb, makeEntryInput(cardB.id, '2026-05-14', { durationMin: 60 }));

    useReportsFilters.getState().setAnchorDate('2026-05-14');
    useReportsFilters.getState().setPeriod('month');
    // Toggle B off — store flips null sentinel into explicit [a]
    useReportsFilters.getState().toggleCardId(cardB.id, [cardA.id, cardB.id]);

    const W = wrapper();
    const { result } = renderHook(() => useReportData(), { wrapper: W });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    expect(data.totals.durationMin).toBe(60);
    expect(data.byCard.map((c) => c.card.id)).toEqual([cardA.id]);
    // byEntry follows the filter — only the cardA entry remains
    expect(data.byEntry).toHaveLength(1);
    expect(data.byEntry[0]!.card.id).toBe(cardA.id);
  });

  it('honors custom range bounds when period === "custom"', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Q', hourlyRate: 10 }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-01-15', { durationMin: 60 }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-12-15', { durationMin: 60 }));
    // Out of range:
    await createEntry(testDb, makeEntryInput(card.id, '2025-12-31', { durationMin: 999 }));

    useReportsFilters.getState().setCustomRange('2026-01-01', '2026-12-31');

    const W = wrapper();
    const { result } = renderHook(() => useReportData(), { wrapper: W });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    expect(data.totals.durationMin).toBe(120);
  });

  it('includes archived cards when showArchived is true', async () => {
    const cardActive = await createCard(testDb, makeCardInput({ name: 'Active', hourlyRate: 10 }));
    const cardArchived = await createCard(
      testDb,
      makeCardInput({ name: 'Old', hourlyRate: 10, isArchived: true, archivedAt: '2026-01-01' }),
    );
    await createEntry(testDb, makeEntryInput(cardActive.id, '2026-05-14', { durationMin: 60 }));
    await createEntry(testDb, makeEntryInput(cardArchived.id, '2026-05-14', { durationMin: 60 }));

    useReportsFilters.getState().setAnchorDate('2026-05-14');
    useReportsFilters.getState().setPeriod('month');
    useReportsFilters.getState().setShowArchived(true);

    const W = wrapper();
    const { result } = renderHook(() => useReportData(), { wrapper: W });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    // With archived included AND selectedCardIds=null, both cards counted
    expect(data.totals.durationMin).toBe(120);
    expect(data.byCard.map((c) => c.card.name).sort()).toEqual(['Active', 'Old']);
  });

  it('excludes archived cards when showArchived is false (default)', async () => {
    const cardActive = await createCard(testDb, makeCardInput({ name: 'Active', hourlyRate: 10 }));
    const cardArchived = await createCard(
      testDb,
      makeCardInput({ name: 'Old', hourlyRate: 10, isArchived: true, archivedAt: '2026-01-01' }),
    );
    await createEntry(testDb, makeEntryInput(cardActive.id, '2026-05-14', { durationMin: 60 }));
    await createEntry(testDb, makeEntryInput(cardArchived.id, '2026-05-14', { durationMin: 60 }));

    useReportsFilters.getState().setAnchorDate('2026-05-14');
    useReportsFilters.getState().setPeriod('month');

    const W = wrapper();
    const { result } = renderHook(() => useReportData(), { wrapper: W });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    expect(data.totals.durationMin).toBe(60);
    expect(data.byCard.map((c) => c.card.name)).toEqual(['Active']);
  });
});
