import { describe, expect, it } from 'vitest';

import type { Card, Entry, MonthAdjustment } from '@/shared/types';

import { computeMonthLedger } from '@/features/payments/monthLedger';

import { computeReport } from './computeReport';

/**
 * Spec 011 SC-002a — for an adjusted month the Payments row's expected amount
 * and the Reports month total for that card are the same number (to the cent).
 */
function card(overrides: Partial<Card>): Card {
  return {
    id: 'c',
    name: 'C',
    color: '#2563EB',
    position: 0,
    defaultDurationMin: 60,
    defaultStartMinutes: 600,
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

function entry(id: string, date: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    cardId: 'c',
    date,
    startMinutes: 600,
    durationMin: 60,
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

const three = [entry('a', '2026-10-01'), entry('b', '2026-10-08'), entry('d', '2026-10-15')];

const CASES: [string, Card, Entry[]][] = [
  ['hourly', card({}), three],
  ['fixed', card({ rateType: 'fixed', hourlyRate: null, fixedTotal: 35 }), three],
  [
    'monthly + custom',
    card({ rateType: 'monthly', hourlyRate: null, monthlyTotal: 250 }),
    [...three, entry('x', '2026-10-20', { useCustomPayment: true, customPayment: 30 })],
  ],
  ['calculated €0', card({ hourlyRate: 0 }), three],
  [
    '€200 over 3 monthly cleanings',
    card({ rateType: 'monthly', hourlyRate: null, monthlyTotal: 250 }),
    three,
  ],
];

const adjustment: MonthAdjustment = {
  id: 'c:2026-10',
  cardId: 'c',
  period: '2026-10',
  amount: 200,
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
};

describe('Payments ↔ Reports parity for an adjusted month', () => {
  it.each(CASES)('%s', (_label, c, entries) => {
    const [row] = computeMonthLedger([c], entries, [], '2026-10', [adjustment]);
    const report = computeReport(entries, [c], ['c'], '2026-10-01', '2026-10-31', [adjustment]);
    const entrySum = report.byEntry.reduce((s, e) => s + e.earnings, 0);

    expect(row!.expected).toBe(200);
    expect(Math.abs(report.byCard[0]!.earnings - row!.expected)).toBeLessThan(0.005);
    expect(Math.abs(entrySum - row!.expected)).toBeLessThan(0.005);
  });
});
