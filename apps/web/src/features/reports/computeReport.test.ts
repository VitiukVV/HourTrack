import { describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { computeReport } from './computeReport';

function makeCard(overrides: Partial<Card> = {}): Card {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'card-1',
    name: 'Hourly Card',
    color: '#3B82F6',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  const now = '2026-05-01T00:00:00.000Z';
  return {
    id: 'entry-1',
    cardId: 'card-1',
    date: '2026-05-14',
    startMinutes: 600,
    durationMin: 60,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('computeReport', () => {
  it('returns zero totals when no entries match the filter', () => {
    const cards = [makeCard()];
    const result = computeReport([], cards, ['card-1']);

    expect(result.totals.durationMin).toBe(0);
    expect(result.totals.earnings).toBe(0);
    expect(result.byEntry).toEqual([]);
    // byCard still includes one zero-valued row for the selected card so the
    // metrics totals stay anchored to the selection.
    expect(result.byCard).toHaveLength(1);
    expect(result.byCard[0]!.durationMin).toBe(0);
    expect(result.byCard[0]!.earnings).toBe(0);
  });

  it('returns truly empty byCard when no cards are selected', () => {
    const cards = [makeCard()];
    const result = computeReport([], cards, []);

    expect(result.byCard).toEqual([]);
    expect(result.byEntry).toEqual([]);
  });

  it('filters entries to only the selectedCardIds', () => {
    const cards = [
      makeCard({ id: 'a', name: 'A', hourlyRate: 10 }),
      makeCard({ id: 'b', name: 'B', hourlyRate: 20 }),
    ];
    const entries = [
      makeEntry({ id: 'e1', cardId: 'a', date: '2026-05-14', durationMin: 60 }),
      makeEntry({ id: 'e2', cardId: 'b', date: '2026-05-14', durationMin: 60 }),
    ];
    const result = computeReport(entries, cards, ['a']);

    expect(result.totals.durationMin).toBe(60);
    expect(result.totals.earnings).toBeCloseTo(10, 5); // 1h × 10 EUR/h
    expect(result.byCard).toHaveLength(1);
    expect(result.byCard[0]!.card.id).toBe('a');
    expect(result.byEntry).toHaveLength(1);
    expect(result.byEntry[0]!.entry.id).toBe('e1');
  });

  it('aggregates hourly-rate entries per card and emits a byEntry row per entry', () => {
    const cards = [
      makeCard({ id: 'a', name: 'A', hourlyRate: 10 }),
      makeCard({ id: 'b', name: 'B', hourlyRate: 20 }),
    ];
    const entries = [
      makeEntry({ id: 'e1', cardId: 'a', date: '2026-05-14', durationMin: 60 }),
      makeEntry({ id: 'e2', cardId: 'b', date: '2026-05-14', durationMin: 120 }),
      makeEntry({ id: 'e3', cardId: 'a', date: '2026-05-15', durationMin: 30 }),
    ];
    const result = computeReport(entries, cards, ['a', 'b']);

    // Totals: 60 + 120 + 30 = 210 min; earnings = 10 + 40 + 5 = 55 EUR
    expect(result.totals.durationMin).toBe(210);
    expect(result.totals.earnings).toBeCloseTo(55, 5);

    // byEntry — one row per filtered entry, sorted by date ASC then id ASC
    expect(result.byEntry).toHaveLength(3);
    expect(result.byEntry.map((r) => r.entry.id)).toEqual(['e1', 'e2', 'e3']);
    expect(result.byEntry[0]!.earnings).toBeCloseTo(10, 5); // 1h × 10
    expect(result.byEntry[1]!.earnings).toBeCloseTo(40, 5); // 2h × 20
    expect(result.byEntry[2]!.earnings).toBeCloseTo(5, 5); // 0.5h × 10

    // byCard, sorted by earnings desc (b=40, a=15)
    expect(result.byCard[0]!.card.id).toBe('b');
    expect(result.byCard[0]!.earnings).toBeCloseTo(40, 5);
    expect(result.byCard[1]!.card.id).toBe('a');
    expect(result.byCard[1]!.earnings).toBeCloseTo(15, 5);
  });

  it('byEntry rows agree with earningsForEntry per row (custom payment passes through)', () => {
    const cards = [makeCard({ id: 'a', name: 'A', hourlyRate: 10 })];
    const entries = [
      makeEntry({ id: 'e1', cardId: 'a', date: '2026-05-14', durationMin: 60 }),
      makeEntry({
        id: 'e2',
        cardId: 'a',
        date: '2026-05-15',
        durationMin: 60,
        useCustomPayment: true,
        customPayment: 999,
      }),
    ];
    const result = computeReport(entries, cards, ['a']);

    // 10 (hourly) + 999 (custom) = 1009
    expect(result.totals.earnings).toBeCloseTo(1009, 5);
    expect(result.byCard[0]!.earnings).toBeCloseTo(1009, 5);

    // Per-row earnings match the totals breakdown
    expect(result.byEntry).toHaveLength(2);
    expect(result.byEntry[0]!.earnings).toBeCloseTo(10, 5);
    expect(result.byEntry[1]!.earnings).toBeCloseTo(999, 5);
  });

  it('distributes fixed-rate total proportionally to hours across byEntry rows', () => {
    const cards = [
      makeCard({
        id: 'fx',
        name: 'Fixed',
        rateType: 'fixed',
        hourlyRate: null,
        fixedTotal: 1000,
      }),
    ];
    const entries = [
      makeEntry({ id: 'e1', cardId: 'fx', date: '2026-05-14', durationMin: 60 }),
      makeEntry({ id: 'e2', cardId: 'fx', date: '2026-05-15', durationMin: 180 }),
    ];
    const result = computeReport(entries, cards, ['fx']);

    // 60+180 = 240 min total; e1 = 60/240*1000 = 250, e2 = 180/240*1000 = 750
    expect(result.totals.durationMin).toBe(240);
    expect(result.totals.earnings).toBeCloseTo(1000, 5);
    expect(result.byCard[0]!.earnings).toBeCloseTo(1000, 5);

    expect(result.byEntry[0]!.earnings).toBeCloseTo(250, 5);
    expect(result.byEntry[1]!.earnings).toBeCloseTo(750, 5);
  });

  it('handles fixed-rate with custom-payment override (remaining pool shrinks)', () => {
    const cards = [
      makeCard({
        id: 'fx',
        name: 'Fixed',
        rateType: 'fixed',
        hourlyRate: null,
        fixedTotal: 1000,
      }),
    ];
    const entries = [
      makeEntry({
        id: 'e1',
        cardId: 'fx',
        date: '2026-05-14',
        durationMin: 60,
        useCustomPayment: true,
        customPayment: 400,
      }),
      makeEntry({ id: 'e2', cardId: 'fx', date: '2026-05-15', durationMin: 120 }),
      makeEntry({ id: 'e3', cardId: 'fx', date: '2026-05-16', durationMin: 60 }),
    ];
    const result = computeReport(entries, cards, ['fx']);

    // Remaining pool = 1000 - 400 = 600 split across 120+60=180 non-custom minutes
    // e2 = 120/180 * 600 = 400; e3 = 60/180 * 600 = 200; e1 = 400 (custom)
    // Total earnings = 400 + 400 + 200 = 1000
    expect(result.totals.earnings).toBeCloseTo(1000, 5);
  });

  it('byEntry is sorted ascending by date with entry.id as a deterministic tiebreak', () => {
    const cards = [makeCard({ id: 'a', name: 'A', hourlyRate: 10 })];
    const entries = [
      // Intentionally scrambled input order and same-day entries with
      // non-alphabetical ids to prove the sort is doing real work.
      makeEntry({ id: 'z-1', cardId: 'a', date: '2026-05-17', durationMin: 60 }),
      makeEntry({ id: 'b-1', cardId: 'a', date: '2026-05-14', durationMin: 60 }),
      makeEntry({ id: 'a-1', cardId: 'a', date: '2026-05-14', durationMin: 60 }),
      makeEntry({ id: 'c-1', cardId: 'a', date: '2026-05-15', durationMin: 60 }),
    ];
    const result = computeReport(entries, cards, ['a']);

    expect(result.byEntry.map((r) => r.entry.id)).toEqual(['a-1', 'b-1', 'c-1', 'z-1']);
  });

  it('byEntry contains every filtered, non-orphan entry exactly once', () => {
    const cards = [
      makeCard({ id: 'a', name: 'A', hourlyRate: 10 }),
      makeCard({ id: 'b', name: 'B', hourlyRate: 20 }),
    ];
    const entries = [
      makeEntry({ id: 'e1', cardId: 'a', date: '2026-05-14', durationMin: 60 }),
      makeEntry({ id: 'e2', cardId: 'b', date: '2026-05-14', durationMin: 60 }),
      makeEntry({ id: 'e3', cardId: 'a', date: '2026-05-15', durationMin: 60 }),
    ];
    const result = computeReport(entries, cards, ['a', 'b']);

    expect(result.byEntry).toHaveLength(entries.length);
    expect(new Set(result.byEntry.map((r) => r.entry.id))).toEqual(new Set(['e1', 'e2', 'e3']));
  });

  it('byCard rows include cards with zero entries in the filtered set, sorted by earnings desc', () => {
    // When a card is selected but has no matching entries in the period, it
    // should still appear with zero values — the metrics card and any future
    // consumer that walks selected cards stays consistent with the selection.
    const cards = [
      makeCard({ id: 'a', name: 'A', hourlyRate: 10 }),
      makeCard({ id: 'b', name: 'B', hourlyRate: 20 }),
    ];
    const entries = [makeEntry({ id: 'e1', cardId: 'a', date: '2026-05-14', durationMin: 60 })];
    const result = computeReport(entries, cards, ['a', 'b']);

    expect(result.byCard).toHaveLength(2);
    expect(result.byCard[0]!.card.id).toBe('a');
    expect(result.byCard[0]!.earnings).toBeCloseTo(10, 5);
    expect(result.byCard[1]!.card.id).toBe('b');
    expect(result.byCard[1]!.durationMin).toBe(0);
    expect(result.byCard[1]!.earnings).toBe(0);
  });

  it('excludes entries whose cardId is missing from the cards list (orphan defense)', () => {
    const cards = [makeCard({ id: 'a', name: 'A', hourlyRate: 10 })];
    const entries = [
      makeEntry({ id: 'e1', cardId: 'a', date: '2026-05-14', durationMin: 60 }),
      makeEntry({ id: 'orphan', cardId: 'ghost', date: '2026-05-14', durationMin: 60 }),
    ];
    const result = computeReport(entries, cards, ['a', 'ghost']);

    // Orphan entry contributes nothing — no card record means no row in any
    // output and no contribution to totals.
    expect(result.totals.durationMin).toBe(60);
    expect(result.byCard).toHaveLength(1);
    expect(result.byEntry).toHaveLength(1);
    expect(result.byEntry[0]!.entry.id).toBe('e1');
  });
});
