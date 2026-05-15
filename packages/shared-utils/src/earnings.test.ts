import { describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { earningsForEntry } from './earnings';

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

describe('earningsForEntry — fixed-rate proportional split', () => {
  it('distributes fixedTotal proportionally across non-custom entries', () => {
    const card = makeCard({ rateType: 'fixed', hourlyRate: null, fixedTotal: 300 });
    const e1 = makeEntry({ id: 'a', durationMin: 60 });
    const e2 = makeEntry({ id: 'b', durationMin: 60 });
    const e3 = makeEntry({ id: 'c', durationMin: 180 });
    // total non-custom minutes = 300; e3 has 180/300 of the share
    const all = [e1, e2, e3];
    expect(earningsForEntry(e1, card, all)).toBeCloseTo(60); // 60/300 * 300
    expect(earningsForEntry(e2, card, all)).toBeCloseTo(60);
    expect(earningsForEntry(e3, card, all)).toBeCloseTo(180);
  });

  it('reduces the remaining pool by sum of customPayments before splitting', () => {
    const card = makeCard({ rateType: 'fixed', hourlyRate: null, fixedTotal: 500 });
    const custom = makeEntry({
      id: 'custom',
      durationMin: 30,
      useCustomPayment: true,
      customPayment: 100,
    });
    const a = makeEntry({ id: 'a', durationMin: 60 });
    const b = makeEntry({ id: 'b', durationMin: 60 });
    const all = [custom, a, b];
    // remaining = 500 - 100 = 400, non-custom minutes = 120, each non-custom 60 -> 200
    expect(earningsForEntry(custom, card, all)).toBe(100); // custom branch
    expect(earningsForEntry(a, card, all)).toBeCloseTo(200);
    expect(earningsForEntry(b, card, all)).toBeCloseTo(200);
  });

  it('returns 0 for non-custom entries when remaining pool is 0', () => {
    const card = makeCard({ rateType: 'fixed', hourlyRate: null, fixedTotal: 100 });
    const big = makeEntry({
      id: 'big',
      durationMin: 30,
      useCustomPayment: true,
      customPayment: 150, // exceeds fixedTotal
    });
    const a = makeEntry({ id: 'a', durationMin: 60 });
    const all = [big, a];
    // remaining = max(0, 100 - 150) = 0
    expect(earningsForEntry(a, card, all)).toBe(0);
  });

  it('returns 0 when all entries are custom (nonCustomMinutes is 0)', () => {
    const card = makeCard({ rateType: 'fixed', hourlyRate: null, fixedTotal: 200 });
    const c1 = makeEntry({
      id: 'c1',
      durationMin: 60,
      useCustomPayment: true,
      customPayment: 30,
    });
    const c2 = makeEntry({
      id: 'c2',
      durationMin: 60,
      useCustomPayment: true,
      customPayment: 30,
    });
    const all = [c1, c2];
    // No non-custom entries -- per spec returns 0 (custom entries hit custom branch)
    expect(earningsForEntry(c1, card, all)).toBe(30);
    expect(earningsForEntry(c2, card, all)).toBe(30);
  });

  it('returns 0 when fixedTotal is null', () => {
    const card = makeCard({ rateType: 'fixed', hourlyRate: null, fixedTotal: null });
    const entry = makeEntry({ durationMin: 60 });
    expect(earningsForEntry(entry, card, [entry])).toBe(0);
  });
});
