import { describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { buildEvent } from './buildEvent';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    name: 'Raquel',
    color: '#EF4444',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 15,
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
    date: '2026-05-15',
    startMinutes: 600,
    durationMin: 165, // 2H 45M
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    createdAt: '2026-05-15T08:00:00.000Z',
    updatedAt: '2026-05-15T08:00:00.000Z',
    ...overrides,
  };
}

describe('buildEvent', () => {
  it('produces the canonical title for an hourly card (rounded EUR)', () => {
    // 2.75h * 15 EUR/h = 41.25 → rounded to 41 in title
    const event = buildEvent(makeEntry({ durationMin: 165 }), makeCard({ hourlyRate: 15 }), []);
    expect(event.summary).toBe('Raquel | 2H 45M | 41 EUR');
  });

  it('matches the PROJECT_PLAN example exactly: Raquel | 2H 45M | 36 EUR (when rate yields ~36)', () => {
    // 2.75h * 13.0909 ≈ 36 EUR — pick a rate that yields exactly 36 after rounding
    const event = buildEvent(
      makeEntry({ durationMin: 165 }),
      makeCard({ hourlyRate: 13.0909 }),
      [],
    );
    expect(event.summary).toBe('Raquel | 2H 45M | 36 EUR');
  });

  it('uses all-day start.date and exclusive end.date (+1 day)', () => {
    const event = buildEvent(makeEntry({ date: '2026-05-15' }), makeCard(), []);
    expect(event.start).toEqual({ date: '2026-05-15' });
    expect(event.end).toEqual({ date: '2026-05-16' });
  });

  it('rolls end.date across month boundary correctly', () => {
    const event = buildEvent(makeEntry({ date: '2026-05-31' }), makeCard(), []);
    expect(event.end).toEqual({ date: '2026-06-01' });
  });

  it('description includes Card / Time / Rate / Earnings for hourly', () => {
    const event = buildEvent(makeEntry({ durationMin: 165 }), makeCard({ hourlyRate: 15 }), []);
    expect(event.description).toContain('Card: Raquel');
    expect(event.description).toContain('Time: 2H 45M');
    expect(event.description).toContain('Rate: 15 EUR/h');
    expect(event.description).toContain('Earnings: 41.25 EUR');
  });

  it('description rate line for fixed-rate card uses the proportional-split copy', () => {
    const card = makeCard({
      rateType: 'fixed',
      hourlyRate: null,
      fixedTotal: 500,
    });
    const event = buildEvent(makeEntry({ durationMin: 165 }), card, []);
    expect(event.description).toContain('Rate: Fixed total: 500 EUR (proportional split)');
  });

  it('description rate line for custom payment is "Custom payment"', () => {
    const entry = makeEntry({ useCustomPayment: true, customPayment: 50 });
    const event = buildEvent(entry, makeCard(), [entry]);
    expect(event.description).toContain('Rate: Custom payment');
    expect(event.description).toContain('Earnings: 50.00 EUR');
  });

  it('includes the note when present, omits the line when null/empty', () => {
    const withNote = buildEvent(makeEntry({ note: 'Refactor sprint' }), makeCard(), []);
    expect(withNote.description).toContain('Note: Refactor sprint');

    const withoutNote = buildEvent(makeEntry({ note: null }), makeCard(), []);
    expect(withoutNote.description).not.toContain('Note:');

    const withEmptyNote = buildEvent(makeEntry({ note: '   ' }), makeCard(), []);
    expect(withEmptyNote.description).not.toContain('Note:');
  });

  it('maps card color via GOOGLE_CALENDAR_COLOR_MAP', () => {
    // #EF4444 → '11' (Tomato → red)
    expect(buildEvent(makeEntry(), makeCard({ color: '#EF4444' }), []).colorId).toBe('11');
    // #3B82F6 → '1' (Lavender → blue)
    expect(buildEvent(makeEntry(), makeCard({ color: '#3B82F6' }), []).colorId).toBe('1');
    // #0F172A (slate) → '8' (graphite fallback — documented collision)
    expect(buildEvent(makeEntry(), makeCard({ color: '#0F172A' }), []).colorId).toBe('8');
  });

  it('falls back to colorId "8" for off-palette colors (defensive)', () => {
    const event = buildEvent(makeEntry(), makeCard({ color: '#123456' }), []);
    expect(event.colorId).toBe('8');
  });
});
