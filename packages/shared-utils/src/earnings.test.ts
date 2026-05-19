import { describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { earningsForEntry, monthlyEarningsForPeriod, monthlyEarningsPerEntry } from './earnings';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    name: 'Test Card',
    color: '#3B82F6',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 10,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
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
    createdAt: '2026-05-14T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    ...overrides,
  };
}

describe('earningsForEntry — custom payment branch', () => {
  it('returns customPayment when useCustomPayment is true (hourly card)', () => {
    const card = makeCard({ rateType: 'hourly', hourlyRate: 10 });
    const entry = makeEntry({
      durationMin: 120,
      useCustomPayment: true,
      customPayment: 99,
    });
    expect(earningsForEntry(entry, card, [entry])).toBe(99);
  });

  it('returns customPayment when useCustomPayment is true (fixed card)', () => {
    const card = makeCard({ rateType: 'fixed', hourlyRate: null, fixedTotal: 500 });
    const entry = makeEntry({
      durationMin: 60,
      useCustomPayment: true,
      customPayment: 42.5,
    });
    expect(earningsForEntry(entry, card, [entry])).toBe(42.5);
  });

  it('returns 0 when useCustomPayment is true but customPayment is null', () => {
    const card = makeCard();
    const entry = makeEntry({ useCustomPayment: true, customPayment: null });
    expect(earningsForEntry(entry, card, [entry])).toBe(0);
  });
});

describe('earningsForEntry — hourly branch', () => {
  it('multiplies hours by hourlyRate', () => {
    const card = makeCard({ rateType: 'hourly', hourlyRate: 20 });
    const entry = makeEntry({ durationMin: 90 }); // 1.5h
    expect(earningsForEntry(entry, card, [entry])).toBe(30);
  });

  it('returns 0 when hourlyRate is null', () => {
    const card = makeCard({ rateType: 'hourly', hourlyRate: null });
    const entry = makeEntry({ durationMin: 60 });
    expect(earningsForEntry(entry, card, [entry])).toBe(0);
  });

  it('handles zero duration', () => {
    const card = makeCard({ rateType: 'hourly', hourlyRate: 15 });
    const entry = makeEntry({ durationMin: 0 });
    expect(earningsForEntry(entry, card, [entry])).toBe(0);
  });
});

describe('earningsForEntry — fixed-rate per-entry flat amount', () => {
  it('returns fixedTotal for every non-custom entry (flat per-entry)', () => {
    const card = makeCard({ rateType: 'fixed', hourlyRate: null, fixedTotal: 35 });
    const e1 = makeEntry({ id: 'a', durationMin: 60 });
    const e2 = makeEntry({ id: 'b', durationMin: 180 });
    const e3 = makeEntry({ id: 'c', durationMin: 30 });
    const all = [e1, e2, e3];
    // Each entry earns the full fixedTotal regardless of durationMin.
    expect(earningsForEntry(e1, card, all)).toBe(35);
    expect(earningsForEntry(e2, card, all)).toBe(35);
    expect(earningsForEntry(e3, card, all)).toBe(35);
  });

  it('3 entries × 35 EUR fixed-card → 3 × 35 (headline user scenario)', () => {
    const card = makeCard({ rateType: 'fixed', hourlyRate: null, fixedTotal: 35 });
    const all = [
      makeEntry({ id: 'a', date: '2026-05-02', durationMin: 180 }),
      makeEntry({ id: 'b', date: '2026-05-09', durationMin: 180 }),
      makeEntry({ id: 'c', date: '2026-05-16', durationMin: 180 }),
    ];
    const sum = all.reduce((acc, e) => acc + earningsForEntry(e, card, all), 0);
    expect(sum).toBe(105);
  });

  it('custom-payment entry uses customPayment; non-custom siblings still earn full fixedTotal', () => {
    const card = makeCard({ rateType: 'fixed', hourlyRate: null, fixedTotal: 35 });
    const custom = makeEntry({
      id: 'custom',
      durationMin: 60,
      useCustomPayment: true,
      customPayment: 100,
    });
    const a = makeEntry({ id: 'a', durationMin: 60 });
    const b = makeEntry({ id: 'b', durationMin: 60 });
    const all = [custom, a, b];
    expect(earningsForEntry(custom, card, all)).toBe(100); // custom branch
    expect(earningsForEntry(a, card, all)).toBe(35);
    expect(earningsForEntry(b, card, all)).toBe(35);
  });

  it('returns 0 when fixedTotal is null', () => {
    const card = makeCard({ rateType: 'fixed', hourlyRate: null, fixedTotal: null });
    const entry = makeEntry({ durationMin: 60 });
    expect(earningsForEntry(entry, card, [entry])).toBe(0);
  });
});

// S21 — monthly retainer model. Per-entry earnings are 0 (the retainer is
// applied at period scope via `monthlyEarningsForPeriod`). Custom payment
// still wins as a one-off override.
describe('earningsForEntry — monthly branch (S21)', () => {
  it('returns 0 for a non-custom entry on a monthly card', () => {
    const card = makeCard({
      rateType: 'monthly',
      hourlyRate: null,
      fixedTotal: null,
      monthlyTotal: 250,
    });
    const entry = makeEntry({ durationMin: 120 });
    expect(earningsForEntry(entry, card, [entry])).toBe(0);
  });

  it('still returns customPayment when useCustomPayment=true on a monthly card', () => {
    // Locked decision: custom payment wins. The retainer doesn't apply on
    // top — the entry is treated as a one-off line item.
    const card = makeCard({
      rateType: 'monthly',
      hourlyRate: null,
      fixedTotal: null,
      monthlyTotal: 250,
    });
    const entry = makeEntry({
      durationMin: 60,
      useCustomPayment: true,
      customPayment: 99,
    });
    expect(earningsForEntry(entry, card, [entry])).toBe(99);
  });

  it('returns 0 when monthlyTotal is null even with non-custom entry', () => {
    const card = makeCard({
      rateType: 'monthly',
      hourlyRate: null,
      fixedTotal: null,
      monthlyTotal: null,
    });
    const entry = makeEntry({ durationMin: 120 });
    expect(earningsForEntry(entry, card, [entry])).toBe(0);
  });
});

describe('monthlyEarningsForPeriod (S21)', () => {
  const monthlyCard = makeCard({
    id: 'mary',
    rateType: 'monthly',
    hourlyRate: null,
    fixedTotal: null,
    monthlyTotal: 250,
  });

  it('returns monthlyTotal when entries cover 1 calendar month in the period', () => {
    // (a) Period = full May, entries in May → 250 EUR.
    const entries = [
      makeEntry({ cardId: 'mary', date: '2026-05-05' }),
      makeEntry({ id: 'e2', cardId: 'mary', date: '2026-05-12' }),
    ];
    expect(monthlyEarningsForPeriod(monthlyCard, entries, '2026-05-01', '2026-05-31')).toBe(250);
  });

  it('returns monthlyTotal × 1 when period spans 2 months but only one has entries', () => {
    // (b) Period spans April + May, entries only in April → 250 EUR.
    const entries = [makeEntry({ cardId: 'mary', date: '2026-04-20' })];
    expect(monthlyEarningsForPeriod(monthlyCard, entries, '2026-04-01', '2026-05-31')).toBe(250);
  });

  it('returns monthlyTotal × 3 when entries land in three distinct months', () => {
    // (e) March / April / May entries → 750 EUR.
    const entries = [
      makeEntry({ id: 'e-mar', cardId: 'mary', date: '2026-03-10' }),
      makeEntry({ id: 'e-apr', cardId: 'mary', date: '2026-04-22' }),
      makeEntry({ id: 'e-may', cardId: 'mary', date: '2026-05-30' }),
    ];
    expect(monthlyEarningsForPeriod(monthlyCard, entries, '2026-03-01', '2026-05-31')).toBe(750);
  });

  it('returns 0 when no entries fall inside the period (period range with no overlap)', () => {
    // (d) Custom range 15.04→20.05 with no entries at all → 0.
    const entries: Entry[] = [];
    expect(monthlyEarningsForPeriod(monthlyCard, entries, '2026-04-15', '2026-05-20')).toBe(0);
  });

  it('returns 0 when monthlyTotal is null (mis-configured monthly card)', () => {
    // (f)
    const card = makeCard({
      rateType: 'monthly',
      hourlyRate: null,
      fixedTotal: null,
      monthlyTotal: null,
    });
    const entries = [makeEntry({ date: '2026-05-12' })];
    expect(monthlyEarningsForPeriod(card, entries, '2026-05-01', '2026-05-31')).toBe(0);
  });

  it('LOCKED: custom range 15.04→20.05 with entries in both months returns 500 (no proration)', () => {
    // (c) / (g) — the headline locked-decision case. Two distinct billable
    // months in scope → 2 × 250 = 500 EUR. NEVER 375 (1.5-month proration).
    const entries = [
      makeEntry({ id: 'apr', cardId: 'mary', date: '2026-04-18' }),
      makeEntry({ id: 'may', cardId: 'mary', date: '2026-05-05' }),
    ];
    expect(monthlyEarningsForPeriod(monthlyCard, entries, '2026-04-15', '2026-05-20')).toBe(500);
  });

  it('returns 0 for a non-monthly card', () => {
    const hourly = makeCard({ rateType: 'hourly', hourlyRate: 25, fixedTotal: null });
    const entries = [makeEntry({ date: '2026-05-12' })];
    expect(monthlyEarningsForPeriod(hourly, entries, '2026-05-01', '2026-05-31')).toBe(0);
  });

  it('ignores entries belonging to other cards (filters defensively by cardId)', () => {
    // Caller may pass the full entry pool; the helper must only count its
    // own card's entries.
    const otherMonthly = makeCard({
      id: 'other',
      rateType: 'monthly',
      hourlyRate: null,
      fixedTotal: null,
      monthlyTotal: 999,
    });
    const entries = [
      // Mary's entry — counted.
      makeEntry({ id: 'm-may', cardId: 'mary', date: '2026-05-10' }),
      // Other card's entry — ignored for Mary's retainer.
      makeEntry({ id: 'o-may', cardId: 'other', date: '2026-05-15' }),
    ];
    expect(monthlyEarningsForPeriod(monthlyCard, entries, '2026-05-01', '2026-05-31')).toBe(250);
    expect(monthlyEarningsForPeriod(otherMonthly, entries, '2026-05-01', '2026-05-31')).toBe(999);
  });

  it('two monthly cards in the same month each contribute their own monthlyTotal', () => {
    // (h) When Reports aggregates monthlyContribution it loops one helper
    // call per selected monthly card → the contributions are independent.
    const sara = makeCard({
      id: 'sara',
      rateType: 'monthly',
      hourlyRate: null,
      fixedTotal: null,
      monthlyTotal: 300,
    });
    const entries = [
      makeEntry({ id: 'm-may', cardId: 'mary', date: '2026-05-10' }),
      makeEntry({ id: 's-may', cardId: 'sara', date: '2026-05-15' }),
    ];
    const maryContrib = monthlyEarningsForPeriod(monthlyCard, entries, '2026-05-01', '2026-05-31');
    const saraContrib = monthlyEarningsForPeriod(sara, entries, '2026-05-01', '2026-05-31');
    expect(maryContrib).toBe(250);
    expect(saraContrib).toBe(300);
    expect(maryContrib + saraContrib).toBe(550);
  });

  it('an entry just before periodStart does not count', () => {
    const entries = [
      // Entry on 2026-04-30 — outside the May period; should NOT trigger a
      // May retainer charge.
      makeEntry({ id: 'apr-30', cardId: 'mary', date: '2026-04-30' }),
    ];
    expect(monthlyEarningsForPeriod(monthlyCard, entries, '2026-05-01', '2026-05-31')).toBe(0);
  });
});

describe('monthlyEarningsPerEntry', () => {
  const monthlyCard = makeCard({
    id: 'mary',
    rateType: 'monthly',
    hourlyRate: null,
    fixedTotal: null,
    monthlyTotal: 250,
  });

  it('divides monthlyTotal evenly across every non-custom entry in the month', () => {
    // 13 entries in May → each carries 250/13 ≈ 19.23 (headline user scenario).
    const dates = [
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
    const entries = dates.map((d, i) => makeEntry({ id: `m${i}`, cardId: 'mary', date: d }));
    for (const e of entries) {
      expect(monthlyEarningsPerEntry(e, monthlyCard, entries)).toBeCloseTo(250 / 13, 5);
    }
    const sum = entries.reduce(
      (acc, e) => acc + monthlyEarningsPerEntry(e, monthlyCard, entries),
      0,
    );
    expect(sum).toBeCloseTo(250, 5);
  });

  it('multiple entries on the same day each count as their own share', () => {
    // 4 non-custom entries total → 250 / 4 = 62.5 each, regardless of date.
    const entries = [
      makeEntry({ id: 'a', cardId: 'mary', date: '2026-05-05', startMinutes: 540 }),
      makeEntry({ id: 'b', cardId: 'mary', date: '2026-05-05', startMinutes: 780 }),
      makeEntry({ id: 'c', cardId: 'mary', date: '2026-05-05', startMinutes: 1020 }),
      makeEntry({ id: 'd', cardId: 'mary', date: '2026-05-12' }),
    ];
    for (const e of entries) {
      expect(monthlyEarningsPerEntry(e, monthlyCard, entries)).toBe(62.5);
    }
  });

  it('per-month: entries in different months split their own month independently', () => {
    // April: 2 entries → 125 each. May: 1 entry → 250.
    const entries = [
      makeEntry({ id: 'a1', cardId: 'mary', date: '2026-04-10' }),
      makeEntry({ id: 'a2', cardId: 'mary', date: '2026-04-20' }),
      makeEntry({ id: 'm1', cardId: 'mary', date: '2026-05-15' }),
    ];
    expect(monthlyEarningsPerEntry(entries[0]!, monthlyCard, entries)).toBe(125);
    expect(monthlyEarningsPerEntry(entries[1]!, monthlyCard, entries)).toBe(125);
    expect(monthlyEarningsPerEntry(entries[2]!, monthlyCard, entries)).toBe(250);
  });

  it('returns 0 for a custom-payment entry (callers should hit custom branch elsewhere)', () => {
    const entries = [
      makeEntry({
        id: 'c',
        cardId: 'mary',
        date: '2026-05-10',
        useCustomPayment: true,
        customPayment: 99,
      }),
      makeEntry({ id: 'n', cardId: 'mary', date: '2026-05-20' }),
    ];
    expect(monthlyEarningsPerEntry(entries[0]!, monthlyCard, entries)).toBe(0);
    // Non-custom sibling owns the full retainer for the month (custom entry
    // is a separate one-off line item — it doesn't dilute the denominator).
    expect(monthlyEarningsPerEntry(entries[1]!, monthlyCard, entries)).toBe(250);
  });

  it('returns 0 for a non-monthly card', () => {
    const hourly = makeCard({ rateType: 'hourly', hourlyRate: 20 });
    const entry = makeEntry({ date: '2026-05-10' });
    expect(monthlyEarningsPerEntry(entry, hourly, [entry])).toBe(0);
  });

  it('returns 0 when monthlyTotal is null', () => {
    const card = makeCard({
      rateType: 'monthly',
      hourlyRate: null,
      fixedTotal: null,
      monthlyTotal: null,
    });
    const entry = makeEntry({ cardId: card.id, date: '2026-05-10' });
    expect(monthlyEarningsPerEntry(entry, card, [entry])).toBe(0);
  });

  it('ignores entries from other cards when counting the month denominator', () => {
    const otherCard = makeCard({
      id: 'other',
      rateType: 'monthly',
      hourlyRate: null,
      fixedTotal: null,
      monthlyTotal: 999,
    });
    const entries = [
      makeEntry({ id: 'm1', cardId: 'mary', date: '2026-05-10' }),
      makeEntry({ id: 'o1', cardId: 'other', date: '2026-05-15' }),
    ];
    expect(monthlyEarningsPerEntry(entries[0]!, monthlyCard, entries)).toBe(250);
    expect(monthlyEarningsPerEntry(entries[1]!, otherCard, entries)).toBe(999);
  });

  it('caller may pass a wider scope (e.g. month) and a narrower visible filter — denominator stays 13', () => {
    // Caller passes ALL 13 entries (the full month). Only 3 happen to be in
    // the visible week; the per-entry share for each of those 3 is still
    // 250/13, never 250/3 — that's the load-bearing invariant for Reports.
    const allMonth = [
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
    ].map((d, i) => makeEntry({ id: `m${i}`, cardId: 'mary', date: d }));
    const visibleWeek = allMonth.slice(0, 3);
    for (const e of visibleWeek) {
      expect(monthlyEarningsPerEntry(e, monthlyCard, allMonth)).toBeCloseTo(250 / 13, 5);
    }
  });
});
