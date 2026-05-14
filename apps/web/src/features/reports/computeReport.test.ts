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
  it('returns empty totals when no entries match the filter', () => {
    const cards = [makeCard()];
    const result = computeReport([], cards, ['card-1']);

    expect(result.totals.durationMin).toBe(0);
    expect(result.totals.earnings).toBe(0);
    expect(result.byDay).toEqual([]);
    expect(result.byCard).toEqual([]);
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
  });

  it('aggregates hourly-rate entries per day and per card', () => {
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

    // byDay
    expect(result.byDay).toHaveLength(2);
    const day14 = result.byDay.find((d) => d.date === '2026-05-14');
    const day15 = result.byDay.find((d) => d.date === '2026-05-15');
    expect(day14?.durationMin).toBe(180);
    expect(day14?.perCardDurationMin['a']).toBe(60);
    expect(day14?.perCardDurationMin['b']).toBe(120);
    expect(day15?.durationMin).toBe(30);
    expect(day15?.perCardDurationMin['a']).toBe(30);

    // byCard, sorted by earnings desc (b=40, a=15)
    expect(result.byCard[0]!.card.id).toBe('b');
    expect(result.byCard[0]!.earnings).toBeCloseTo(40, 5);
    expect(result.byCard[1]!.card.id).toBe('a');
    expect(result.byCard[1]!.earnings).toBeCloseTo(15, 5);
  });

  it('respects custom-payment overrides for entry earnings', () => {
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
  });

  it('distributes fixed-rate total proportionally to hours', () => {
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

    const day14 = result.byDay.find((d) => d.date === '2026-05-14');
    const day15 = result.byDay.find((d) => d.date === '2026-05-15');
    expect(day14?.perCardDurationMin['fx']).toBe(60);
    expect(day15?.perCardDurationMin['fx']).toBe(180);
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

  it('does NOT emit byDay rows for days outside the entry set (req #12)', () => {
    const cards = [makeCard({ id: 'a', name: 'A', hourlyRate: 10 })];
    const entries = [
      makeEntry({ id: 'e1', cardId: 'a', date: '2026-05-14', durationMin: 60 }),
      makeEntry({ id: 'e2', cardId: 'a', date: '2026-05-17', durationMin: 60 }),
    ];
    const result = computeReport(entries, cards, ['a']);

    // 14 and 17 only — no 15, 16
    expect(result.byDay.map((d) => d.date)).toEqual(['2026-05-14', '2026-05-17']);
  });

  it('byDay rows are sorted ascending by date', () => {
    const cards = [makeCard({ id: 'a', name: 'A', hourlyRate: 10 })];
    const entries = [
      makeEntry({ id: 'e1', cardId: 'a', date: '2026-05-17', durationMin: 60 }),
      makeEntry({ id: 'e2', cardId: 'a', date: '2026-05-14', durationMin: 60 }),
      makeEntry({ id: 'e3', cardId: 'a', date: '2026-05-15', durationMin: 60 }),
    ];
    const result = computeReport(entries, cards, ['a']);

    expect(result.byDay.map((d) => d.date)).toEqual(['2026-05-14', '2026-05-15', '2026-05-17']);
  });

  it('byCard rows include cards with zero entries in the filtered set, sorted by earnings desc', () => {
    // When a card is selected but has no matching entries in the period, it
    // should still appear with zero values — Reports table renders one row
    // per selected card so the user can see "this card had no activity".
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

  it('ignores entries whose cardId is missing from the cards list (orphan defense)', () => {
    const cards = [makeCard({ id: 'a', name: 'A', hourlyRate: 10 })];
    const entries = [
      makeEntry({ id: 'e1', cardId: 'a', date: '2026-05-14', durationMin: 60 }),
      makeEntry({ id: 'orphan', cardId: 'ghost', date: '2026-05-14', durationMin: 60 }),
    ];
    const result = computeReport(entries, cards, ['a', 'ghost']);

    // Orphan entry contributes nothing — its card isn't known so earnings can't be computed.
    expect(result.totals.durationMin).toBe(60);
    expect(result.byCard).toHaveLength(1);
  });
});
