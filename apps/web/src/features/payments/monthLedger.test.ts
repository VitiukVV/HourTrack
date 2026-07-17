import { describe, expect, it } from 'vitest';

import type { Card, Entry, Payment } from '@hourtrack/shared-types';

import { computeMonthLedger, ledgerTotals } from './monthLedger';

const PERIOD = '2026-07';

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    name: `Card ${id}`,
    color: '#2563EB',
    defaultDurationMin: 60,
    defaultStartMinutes: 540,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function entry(id: string, cardId: string, date: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    cardId,
    date,
    startMinutes: 540,
    durationMin: 150, // 2.5h
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
    ...overrides,
  };
}

function payment(
  id: string,
  cardId: string,
  amount: number,
  overrides: Partial<Payment> = {},
): Payment {
  return {
    id,
    cardId,
    period: PERIOD,
    amount,
    paidOn: '2026-07-15',
    note: null,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeMonthLedger — expected amount per rate type', () => {
  it('hourly card: expected = sum of hours × rate', () => {
    const cards = [card('h', { rateType: 'hourly', hourlyRate: 20 })];
    const entries = [
      entry('e1', 'h', '2026-07-07', { durationMin: 150 }), // 2.5h → 50
      entry('e2', 'h', '2026-07-09', { durationMin: 150 }), // 2.5h → 50
    ];
    const [row] = computeMonthLedger(cards, entries, [], PERIOD);
    expect(row!.expected).toBe(100);
    expect(row!.sessions).toBe(2);
    expect(row!.totalMinutes).toBe(300);
  });

  it('fixed card: expected = flat per-entry amount × entries', () => {
    const cards = [card('f', { rateType: 'fixed', hourlyRate: null, fixedTotal: 35 })];
    const entries = [
      entry('e1', 'f', '2026-07-02'),
      entry('e2', 'f', '2026-07-10'),
      entry('e3', 'f', '2026-07-20'),
    ];
    const [row] = computeMonthLedger(cards, entries, [], PERIOD);
    expect(row!.expected).toBe(105);
  });

  it('monthly retainer card ("Марі 250"): expected = 250 with ≥1 entry', () => {
    const cards = [
      card('m', { name: 'Марі', rateType: 'monthly', hourlyRate: null, monthlyTotal: 250 }),
    ];
    const entries = [entry('e1', 'm', '2026-07-03'), entry('e2', 'm', '2026-07-18')];
    const [row] = computeMonthLedger(cards, entries, [], PERIOD);
    expect(row!.expected).toBe(250);
  });

  it('monthly retainer card with ZERO entries does not appear (no payment either)', () => {
    const cards = [card('m', { rateType: 'monthly', hourlyRate: null, monthlyTotal: 250 })];
    const rows = computeMonthLedger(cards, [], [], PERIOD);
    expect(rows).toHaveLength(0);
  });

  it('monthly card retainer + custom-payment entries stack on top', () => {
    const cards = [card('m', { rateType: 'monthly', hourlyRate: null, monthlyTotal: 250 })];
    const entries = [
      entry('e1', 'm', '2026-07-03'), // non-custom → retainer only
      entry('e2', 'm', '2026-07-10', { useCustomPayment: true, customPayment: 40 }),
    ];
    const [row] = computeMonthLedger(cards, entries, [], PERIOD);
    expect(row!.expected).toBe(290);
  });

  it('custom-payment entry on an hourly card uses the custom amount', () => {
    const cards = [card('h', { rateType: 'hourly', hourlyRate: 20 })];
    const entries = [
      entry('e1', 'h', '2026-07-05', { durationMin: 120 }), // 2h → 40
      entry('e2', 'h', '2026-07-06', { useCustomPayment: true, customPayment: 99 }),
    ];
    const [row] = computeMonthLedger(cards, entries, [], PERIOD);
    expect(row!.expected).toBe(139);
  });
});

describe('computeMonthLedger — received / status inputs / inclusion', () => {
  it('received = sum of the card payments for the period', () => {
    const cards = [card('h', { hourlyRate: 20 })];
    const entries = [entry('e1', 'h', '2026-07-07', { durationMin: 300 })]; // 5h → 100
    const payments = [payment('p1', 'h', 60), payment('p2', 'h', 40)];
    const [row] = computeMonthLedger(cards, entries, payments, PERIOD);
    expect(row!.expected).toBe(100);
    expect(row!.received).toBe(100);
  });

  it('includes an orphan payment (payment but no entries) with expected 0', () => {
    const cards = [card('h')];
    const payments = [payment('p1', 'h', 30)];
    const [row] = computeMonthLedger(cards, [], payments, PERIOD);
    expect(row!.expected).toBe(0);
    expect(row!.received).toBe(30);
    expect(row!.sessions).toBe(0);
  });

  it('only counts payments matching the selected period (paidOn is irrelevant)', () => {
    const cards = [card('h', { hourlyRate: 20 })];
    const entries = [entry('e1', 'h', '2026-07-07', { durationMin: 60 })]; // 1h → 20
    const payments = [
      // Paid in August but FOR July → counts.
      payment('p1', 'h', 20, { period: '2026-07', paidOn: '2026-08-04' }),
      // Paid for a different period → excluded.
      payment('p2', 'h', 99, { period: '2026-06', paidOn: '2026-07-01' }),
    ];
    const [row] = computeMonthLedger(cards, entries, payments, PERIOD);
    expect(row!.received).toBe(20);
    expect(row!.payments).toHaveLength(1);
  });

  it('includes archived cards that have activity in the period', () => {
    const cards = [card('h', { isArchived: true, archivedAt: '2026-07-20T00:00:00.000Z' })];
    const entries = [entry('e1', 'h', '2026-07-07')];
    const rows = computeMonthLedger(cards, entries, [], PERIOD);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.card.isArchived).toBe(true);
  });

  it('respects local-date month boundaries (1st and last day included; adjacent months excluded)', () => {
    const cards = [card('h', { hourlyRate: 20 })];
    const entries = [
      entry('e1', 'h', '2026-06-30', { durationMin: 60 }), // prev month → excluded
      entry('e2', 'h', '2026-07-01', { durationMin: 60 }), // 1st → included (1h → 20)
      entry('e3', 'h', '2026-07-31', { durationMin: 60 }), // last → included (1h → 20)
      entry('e4', 'h', '2026-08-01', { durationMin: 60 }), // next month → excluded
    ];
    const [row] = computeMonthLedger(cards, entries, [], PERIOD);
    expect(row!.sessions).toBe(2);
    expect(row!.expected).toBe(40);
  });

  it('skips payments whose card no longer exists (hard-deleted)', () => {
    const cards = [card('h')];
    const payments = [payment('p1', 'ghost', 50)];
    const rows = computeMonthLedger(cards, [], payments, PERIOD);
    expect(rows).toHaveLength(0);
  });

  it('sorts rows by card name', () => {
    const cards = [card('z', { name: 'Zoe' }), card('a', { name: 'Anna' })];
    const entries = [entry('e1', 'z', '2026-07-05'), entry('e2', 'a', '2026-07-05')];
    const rows = computeMonthLedger(cards, entries, [], PERIOD);
    expect(rows.map((r) => r.card.name)).toEqual(['Anna', 'Zoe']);
  });
});

describe('ledgerTotals', () => {
  it('sums expected / received and derives outstanding (never negative)', () => {
    const cards = [card('a', { hourlyRate: 20 }), card('b', { hourlyRate: 20 })];
    const entries = [
      entry('e1', 'a', '2026-07-07', { durationMin: 300 }), // 5h → 100
      entry('e2', 'b', '2026-07-08', { durationMin: 60 }), // 1h → 20
    ];
    const payments = [payment('p1', 'a', 100), payment('p2', 'b', 5)];
    const rows = computeMonthLedger(cards, entries, payments, PERIOD);
    const totals = ledgerTotals(rows);
    expect(totals.expected).toBe(120);
    expect(totals.received).toBe(105);
    expect(totals.outstanding).toBe(15);
  });

  it('outstanding clamps to 0 on overpayment', () => {
    const cards = [card('a', { hourlyRate: 20 })];
    const entries = [entry('e1', 'a', '2026-07-07', { durationMin: 60 })]; // 1h → 20
    const payments = [payment('p1', 'a', 50)];
    const totals = ledgerTotals(computeMonthLedger(cards, entries, payments, PERIOD));
    expect(totals.outstanding).toBe(0);
  });
});

// S31 Task 2 — the ledger boundary rounds `expected` (and thus outstanding)
// to cents once, so a fractional-rate month never accumulates sub-cent dust
// in the totals strip (UR-31-1, audit "0.0033-style dust summed across a
// month").
describe('cent-rounding at the ledger boundary (S31 / UR-31-1)', () => {
  it('the audit repro — rate 40 €/h, 50-min entry → expected 33.33, outstanding 0 when paid 33.33', () => {
    const cards = [card('h', { rateType: 'hourly', hourlyRate: 40 })];
    const entries = [entry('e1', 'h', '2026-07-07', { durationMin: 50 })]; // 33.3333...
    const payments = [payment('p1', 'h', 33.33)];
    const [row] = computeMonthLedger(cards, entries, payments, PERIOD);
    expect(row!.expected).toBe(33.33);
    const totals = ledgerTotals([row!]);
    expect(totals.outstanding).toBe(0);
  });

  it('no sub-cent dust in outstanding across a month of fractional-rate cards', () => {
    // Three cards, each expected 33.3333..., each paid the displayed 33.33.
    // Pre-fix: outstanding summed to ~0.0099 of dust. Post-fix: 0.
    const cards = [
      card('a', { name: 'A', rateType: 'hourly', hourlyRate: 40 }),
      card('b', { name: 'B', rateType: 'hourly', hourlyRate: 40 }),
      card('c', { name: 'C', rateType: 'hourly', hourlyRate: 40 }),
    ];
    const entries = [
      entry('e1', 'a', '2026-07-05', { durationMin: 50 }),
      entry('e2', 'b', '2026-07-05', { durationMin: 50 }),
      entry('e3', 'c', '2026-07-05', { durationMin: 50 }),
    ];
    const payments = [
      payment('p1', 'a', 33.33),
      payment('p2', 'b', 33.33),
      payment('p3', 'c', 33.33),
    ];
    const totals = ledgerTotals(computeMonthLedger(cards, entries, payments, PERIOD));
    expect(totals.outstanding).toBe(0);
    expect(totals.expected).toBe(99.99);
  });
});
