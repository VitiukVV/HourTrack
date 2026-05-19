import { describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { computeReport } from './computeReport';

function makeCard(overrides: Partial<Card> = {}): Card {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'card-1',
    name: 'Hourly Card',
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

// S21 — `computeReport` now takes `periodStart` / `periodEnd` so monthly
// retainer aggregation has a date window to count distinct YYYY-MM slots in.
// Existing hourly / fixed test cases use a wide window covering all of 2026
// to keep them shape-stable; monthly-specific cases below scope tighter.
const ANY_PERIOD_START = '2026-01-01';
const ANY_PERIOD_END = '2026-12-31';

describe('computeReport', () => {
  it('returns zero totals when no entries match the filter', () => {
    const cards = [makeCard()];
    const result = computeReport([], cards, ['card-1'], ANY_PERIOD_START, ANY_PERIOD_END);

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
    const result = computeReport([], cards, [], ANY_PERIOD_START, ANY_PERIOD_END);

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
    const result = computeReport(entries, cards, ['a'], ANY_PERIOD_START, ANY_PERIOD_END);

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
    const result = computeReport(entries, cards, ['a', 'b'], ANY_PERIOD_START, ANY_PERIOD_END);

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
    const result = computeReport(entries, cards, ['a'], ANY_PERIOD_START, ANY_PERIOD_END);

    // 10 (hourly) + 999 (custom) = 1009
    expect(result.totals.earnings).toBeCloseTo(1009, 5);
    expect(result.byCard[0]!.earnings).toBeCloseTo(1009, 5);

    // Per-row earnings match the totals breakdown
    expect(result.byEntry).toHaveLength(2);
    expect(result.byEntry[0]!.earnings).toBeCloseTo(10, 5);
    expect(result.byEntry[1]!.earnings).toBeCloseTo(999, 5);
  });

  it('fixed-rate: each entry earns full fixedTotal (per-entry flat amount)', () => {
    const cards = [
      makeCard({
        id: 'fx',
        name: 'Fixed',
        rateType: 'fixed',
        hourlyRate: null,
        fixedTotal: 35,
        monthlyTotal: null,
      }),
    ];
    const entries = [
      makeEntry({ id: 'e1', cardId: 'fx', date: '2026-05-02', durationMin: 180 }),
      makeEntry({ id: 'e2', cardId: 'fx', date: '2026-05-09', durationMin: 180 }),
      makeEntry({ id: 'e3', cardId: 'fx', date: '2026-05-16', durationMin: 180 }),
    ];
    const result = computeReport(entries, cards, ['fx'], ANY_PERIOD_START, ANY_PERIOD_END);

    // 3 entries × 35 = 105 EUR; durations stay informational only.
    expect(result.totals.durationMin).toBe(540);
    expect(result.totals.earnings).toBeCloseTo(105, 5);
    expect(result.byCard[0]!.earnings).toBeCloseTo(105, 5);

    expect(result.byEntry[0]!.earnings).toBe(35);
    expect(result.byEntry[1]!.earnings).toBe(35);
    expect(result.byEntry[2]!.earnings).toBe(35);
  });

  it('fixed-rate with custom-payment override: custom uses its own amount, others still earn full fixedTotal', () => {
    const cards = [
      makeCard({
        id: 'fx',
        name: 'Fixed',
        rateType: 'fixed',
        hourlyRate: null,
        fixedTotal: 35,
        monthlyTotal: null,
      }),
    ];
    const entries = [
      makeEntry({
        id: 'e1',
        cardId: 'fx',
        date: '2026-05-14',
        durationMin: 60,
        useCustomPayment: true,
        customPayment: 100,
      }),
      makeEntry({ id: 'e2', cardId: 'fx', date: '2026-05-15', durationMin: 120 }),
      makeEntry({ id: 'e3', cardId: 'fx', date: '2026-05-16', durationMin: 60 }),
    ];
    const result = computeReport(entries, cards, ['fx'], ANY_PERIOD_START, ANY_PERIOD_END);

    // e1 = 100 (custom), e2 = 35, e3 = 35; total = 170.
    expect(result.totals.earnings).toBeCloseTo(170, 5);
    const e1 = result.byEntry.find((r) => r.entry.id === 'e1');
    const e2 = result.byEntry.find((r) => r.entry.id === 'e2');
    const e3 = result.byEntry.find((r) => r.entry.id === 'e3');
    expect(e1?.earnings).toBe(100);
    expect(e2?.earnings).toBe(35);
    expect(e3?.earnings).toBe(35);
  });

  // S16b: tiebreak is now `(date ASC, startMinutes ASC, id ASC)`. Same-day
  // entries with identical startMinutes still fall back to id for absolute
  // stability — the test below covers that fallback explicitly.
  it('byEntry is sorted ascending by date with same-day order by startMinutes ASC then id ASC', () => {
    const cards = [makeCard({ id: 'a', name: 'A', hourlyRate: 10 })];
    const entries = [
      // Mixed dates with identical startMinutes so the primary key drives.
      makeEntry({
        id: 'z-1',
        cardId: 'a',
        date: '2026-05-17',
        startMinutes: 600,
        durationMin: 60,
      }),
      makeEntry({
        id: 'b-1',
        cardId: 'a',
        date: '2026-05-14',
        startMinutes: 600,
        durationMin: 60,
      }),
      makeEntry({
        id: 'a-1',
        cardId: 'a',
        date: '2026-05-14',
        startMinutes: 600,
        durationMin: 60,
      }),
      makeEntry({
        id: 'c-1',
        cardId: 'a',
        date: '2026-05-15',
        startMinutes: 600,
        durationMin: 60,
      }),
    ];
    const result = computeReport(entries, cards, ['a'], ANY_PERIOD_START, ANY_PERIOD_END);

    // 2026-05-14 entries (a-1, b-1 — same startMinutes → id tiebreak), then
    // 2026-05-15 (c-1), then 2026-05-17 (z-1).
    expect(result.byEntry.map((r) => r.entry.id)).toEqual(['a-1', 'b-1', 'c-1', 'z-1']);
  });

  it('S16b: same-day different startMinutes → ordered by startMinutes ASC (10:00 after 08:00)', () => {
    const cards = [makeCard({ id: 'a', name: 'A', hourlyRate: 10 })];
    const entries = [
      // Intentionally inserted later-time-id first so id-tiebreak would
      // produce the wrong order if startMinutes weren't the primary key.
      makeEntry({
        id: 'b-late',
        cardId: 'a',
        date: '2026-05-14',
        startMinutes: 600, // 10:00
        durationMin: 60,
      }),
      makeEntry({
        id: 'a-early',
        cardId: 'a',
        date: '2026-05-14',
        startMinutes: 480, // 08:00
        durationMin: 60,
      }),
    ];
    const result = computeReport(entries, cards, ['a'], ANY_PERIOD_START, ANY_PERIOD_END);

    // 08:00 first, 10:00 second
    expect(result.byEntry.map((r) => r.entry.id)).toEqual(['a-early', 'b-late']);
  });

  it('S16b: same-day same-startMinutes → falls back to id ASC for absolute stability', () => {
    const cards = [makeCard({ id: 'a', name: 'A', hourlyRate: 10 })];
    const entries = [
      makeEntry({
        id: 'z',
        cardId: 'a',
        date: '2026-05-14',
        startMinutes: 540,
        durationMin: 60,
      }),
      makeEntry({
        id: 'a',
        cardId: 'a',
        date: '2026-05-14',
        startMinutes: 540,
        durationMin: 60,
      }),
    ];
    const result = computeReport(entries, cards, ['a'], ANY_PERIOD_START, ANY_PERIOD_END);

    expect(result.byEntry.map((r) => r.entry.id)).toEqual(['a', 'z']);
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
    const result = computeReport(entries, cards, ['a', 'b'], ANY_PERIOD_START, ANY_PERIOD_END);

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
    const result = computeReport(entries, cards, ['a', 'b'], ANY_PERIOD_START, ANY_PERIOD_END);

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
    const result = computeReport(entries, cards, ['a', 'ghost'], ANY_PERIOD_START, ANY_PERIOD_END);

    // Orphan entry contributes nothing — no card record means no row in any
    // output and no contribution to totals.
    expect(result.totals.durationMin).toBe(60);
    expect(result.byCard).toHaveLength(1);
    expect(result.byEntry).toHaveLength(1);
    expect(result.byEntry[0]!.entry.id).toBe('e1');
  });
});

// S21 — monthly retainer cards in the Reports aggregation.
describe('computeReport — S21 monthly retainer', () => {
  function monthlyCard(id: string, monthlyTotal: number, name = id): Card {
    return makeCard({
      id,
      name,
      rateType: 'monthly',
      hourlyRate: null,
      fixedTotal: null,
      monthlyTotal,
    });
  }

  it('(a) Mixed monthly+hourly: total folds standardSum + monthlyContribution', () => {
    const cards = [monthlyCard('mary', 250), makeCard({ id: 'bob', name: 'Bob', hourlyRate: 20 })];
    const entries = [
      // Mary: 5 × 2h entries in May. Retainer = 250 (single billable month).
      makeEntry({ id: 'm1', cardId: 'mary', date: '2026-05-02', durationMin: 120 }),
      makeEntry({ id: 'm2', cardId: 'mary', date: '2026-05-09', durationMin: 120 }),
      makeEntry({ id: 'm3', cardId: 'mary', date: '2026-05-16', durationMin: 120 }),
      makeEntry({ id: 'm4', cardId: 'mary', date: '2026-05-23', durationMin: 120 }),
      makeEntry({ id: 'm5', cardId: 'mary', date: '2026-05-30', durationMin: 120 }),
      // Bob: 4 × 1h in May. 4 × 20 = 80 EUR.
      makeEntry({ id: 'b1', cardId: 'bob', date: '2026-05-04', durationMin: 60 }),
      makeEntry({ id: 'b2', cardId: 'bob', date: '2026-05-11', durationMin: 60 }),
      makeEntry({ id: 'b3', cardId: 'bob', date: '2026-05-18', durationMin: 60 }),
      makeEntry({ id: 'b4', cardId: 'bob', date: '2026-05-25', durationMin: 60 }),
    ];
    const result = computeReport(entries, cards, ['mary', 'bob'], '2026-05-01', '2026-05-31');

    // Total duration: 5×120 + 4×60 = 600 + 240 = 840 min (14h).
    expect(result.totals.durationMin).toBe(840);
    // Total earnings: 250 (Mary's retainer) + 80 (Bob's hourly) = 330 EUR.
    expect(result.totals.earnings).toBeCloseTo(330, 5);
    expect(result.monthlyContribution).toBeCloseTo(250, 5);

    // byCard rows: Mary's row has earnings 250 (the retainer); Bob's has 80.
    const mary = result.byCard.find((r) => r.card.id === 'mary');
    const bob = result.byCard.find((r) => r.card.id === 'bob');
    expect(mary?.earnings).toBeCloseTo(250, 5);
    expect(bob?.earnings).toBeCloseTo(80, 5);

    // byEntry rows for Mary each carry 250/5 = 50 (per-day retainer split,
    // each day has a single non-custom entry). Bob's rows carry 20 each.
    const maryEntryRows = result.byEntry.filter((r) => r.card.id === 'mary');
    const bobEntryRows = result.byEntry.filter((r) => r.card.id === 'bob');
    expect(maryEntryRows).toHaveLength(5);
    expect(maryEntryRows.every((r) => r.earnings === 50)).toBe(true);
    expect(bobEntryRows).toHaveLength(4);
    expect(bobEntryRows.every((r) => r.earnings === 20)).toBe(true);
  });

  it('(b) Two monthly cards in same month each contribute independently', () => {
    const cards = [monthlyCard('mary', 250), monthlyCard('sara', 300)];
    const entries = [
      makeEntry({ id: 'm1', cardId: 'mary', date: '2026-05-05', durationMin: 60 }),
      makeEntry({ id: 's1', cardId: 'sara', date: '2026-05-15', durationMin: 120 }),
    ];
    const result = computeReport(entries, cards, ['mary', 'sara'], '2026-05-01', '2026-05-31');

    // Total earnings: 250 + 300 = 550.
    expect(result.totals.earnings).toBeCloseTo(550, 5);
    expect(result.monthlyContribution).toBeCloseTo(550, 5);

    // Both byCard rows show their retainer.
    const mary = result.byCard.find((r) => r.card.id === 'mary');
    const sara = result.byCard.find((r) => r.card.id === 'sara');
    expect(mary?.earnings).toBeCloseTo(250, 5);
    expect(sara?.earnings).toBeCloseTo(300, 5);
  });

  it('(c) LOCKED: custom range 15.04→20.05 with entries in both months returns 500 (no proration)', () => {
    const cards = [monthlyCard('mary', 250)];
    const entries = [
      makeEntry({ id: 'apr', cardId: 'mary', date: '2026-04-18', durationMin: 60 }),
      makeEntry({ id: 'may', cardId: 'mary', date: '2026-05-05', durationMin: 60 }),
    ];
    const result = computeReport(entries, cards, ['mary'], '2026-04-15', '2026-05-20');

    // 2 billable months × 250 = 500 EUR (NOT 375 — no 1.5-month proration).
    expect(result.totals.earnings).toBeCloseTo(500, 5);
    expect(result.monthlyContribution).toBeCloseTo(500, 5);
  });

  it('renders zero retainer for a monthly card with no entries in the period', () => {
    const cards = [monthlyCard('mary', 250)];
    // No entries in May.
    const result = computeReport([], cards, ['mary'], '2026-05-01', '2026-05-31');
    expect(result.totals.earnings).toBe(0);
    expect(result.monthlyContribution).toBe(0);
    expect(result.byCard).toHaveLength(1);
    expect(result.byCard[0]!.earnings).toBe(0);
  });

  it('custom-payment override on a monthly entry counts on top of the retainer', () => {
    // The custom payment is a one-off line item; the retainer still applies.
    const cards = [monthlyCard('mary', 250)];
    const entries = [
      makeEntry({ id: 'reg', cardId: 'mary', date: '2026-05-05', durationMin: 60 }),
      makeEntry({
        id: 'bonus',
        cardId: 'mary',
        date: '2026-05-15',
        durationMin: 30,
        useCustomPayment: true,
        customPayment: 75,
      }),
    ];
    const result = computeReport(entries, cards, ['mary'], '2026-05-01', '2026-05-31');

    // Retainer 250 + custom 75 = 325 total.
    expect(result.totals.earnings).toBeCloseTo(325, 5);
    expect(result.monthlyContribution).toBeCloseTo(250, 5);
    // Non-custom sibling owns the full retainer for the month (custom entry
    // is a separate one-off line item, so it doesn't dilute the per-day
    // denominator). Custom row carries its 75 EUR override.
    const regRow = result.byEntry.find((r) => r.entry.id === 'reg');
    const bonusRow = result.byEntry.find((r) => r.entry.id === 'bonus');
    expect(regRow?.earnings).toBe(250);
    expect(bonusRow?.earnings).toBe(75);
  });

  it('mixed-rate report exposes monthlyContribution alongside the grand total', () => {
    // Sanity: monthlyContribution is a STANDALONE breakdown, not buried in
    // totals. Consumers that want "X EUR standard + Y EUR retainers" can
    // subtract: standardSum = totals.earnings - monthlyContribution.
    const cards = [monthlyCard('m', 100), makeCard({ id: 'h', name: 'H', hourlyRate: 50 })];
    const entries = [
      makeEntry({ id: 'm-may', cardId: 'm', date: '2026-05-05', durationMin: 60 }),
      makeEntry({ id: 'h-may', cardId: 'h', date: '2026-05-10', durationMin: 120 }), // 2h × 50 = 100
    ];
    const result = computeReport(entries, cards, ['m', 'h'], '2026-05-01', '2026-05-31');

    expect(result.monthlyContribution).toBeCloseTo(100, 5);
    expect(result.totals.earnings).toBeCloseTo(200, 5);
    // Standard sum derivation:
    expect(result.totals.earnings - result.monthlyContribution).toBeCloseTo(100, 5);
  });

  it('headline user scenario: 13 entries in May, week filter shows 3 — each carries 250/13', () => {
    // Mary card: 13 entries spread across May. Caller passes ALL of them
    // (the wider month scope), with a week filter `[2026-05-04, 2026-05-10]`.
    // 3 of the 13 fall inside the week; each visible row should still show
    // 250 / 13 ≈ 19.23 (denominator counts the full month, not the visible
    // 3). Sum across the 3 visible rows ≈ 57.69 (3 × 19.23).
    const cards = [monthlyCard('mary', 250)];
    const allDates = [
      '2026-05-02',
      '2026-05-04',
      '2026-05-06',
      '2026-05-08',
      '2026-05-10',
      '2026-05-12',
      '2026-05-14',
      '2026-05-16',
      '2026-05-18',
      '2026-05-20',
      '2026-05-22',
      '2026-05-24',
      '2026-05-26',
    ];
    const entries = allDates.map((d, i) =>
      makeEntry({ id: `m${i}`, cardId: 'mary', date: d, durationMin: 60 }),
    );
    const result = computeReport(entries, cards, ['mary'], '2026-05-04', '2026-05-10');

    // 3 entries fall in [2026-05-04, 2026-05-10]: 2026-05-04, 2026-05-06, 2026-05-08, 2026-05-10
    // Wait — 04, 06, 08, 10 = 4 entries. Let me recompute: dates in the week
    // are those >= '2026-05-04' AND <= '2026-05-10' → 04, 06, 08, 10 = 4 rows.
    expect(result.byEntry).toHaveLength(4);
    for (const row of result.byEntry) {
      expect(row.earnings).toBeCloseTo(250 / 13, 5);
    }
    // Total earnings for the visible filter = 4 × (250/13) ≈ 76.92.
    expect(result.totals.earnings).toBeCloseTo((4 * 250) / 13, 5);
    expect(result.monthlyContribution).toBeCloseTo((4 * 250) / 13, 5);
  });
});
