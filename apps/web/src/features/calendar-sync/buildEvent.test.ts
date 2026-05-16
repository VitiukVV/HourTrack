import { describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { buildEvent } from './buildEvent';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    name: 'Raquel',
    color: '#DC2626',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 15,
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
    date: '2026-05-15',
    startMinutes: 600, // 10:00
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

  it('emits time-bound start/end with floating wall-clock RFC3339 + IANA timeZone', () => {
    // 10:00 + 4h on 2026-05-15 → 10:00..14:00 wall-clock in Europe/Kyiv
    const event = buildEvent(
      makeEntry({ date: '2026-05-15', startMinutes: 600, durationMin: 240 }),
      makeCard(),
      [],
    );

    expect(event.start.dateTime).toBe('2026-05-15T10:00:00');
    expect(event.end.dateTime).toBe('2026-05-15T14:00:00');
    // vitest.setup.ts pins `process.env.TZ = 'Europe/Kyiv'` BEFORE imports run.
    // Node's `Intl.DateTimeFormat().resolvedOptions().timeZone` resolution
    // depends on bundled ICU + tzdata: tzdata 2022b+ canonicalises to
    // 'Europe/Kyiv' (post-2022 rename), older tzdata still returns the
    // pre-rename canonical 'Europe/Kiev'. Both refer to the SAME zone, so
    // either is correct from Google Calendar's perspective. Accept both
    // forms in the assertion to keep CI stable across Node minor versions.
    expect(['Europe/Kyiv', 'Europe/Kiev']).toContain(event.start.timeZone);
    expect(['Europe/Kyiv', 'Europe/Kiev']).toContain(event.end.timeZone);
    // The two endpoints must agree with each other regardless of which
    // canonical form ICU picked.
    expect(event.start.timeZone).toBe(event.end.timeZone);
  });

  it('locks RFC3339 contract: NO trailing Z, NO ±HH:MM offset on dateTime strings', () => {
    // If anyone replaces the date-fns format with `.toISOString()`, both
    // assertions trip — UTC-stamped Z + explicit timeZone is the silent-drift
    // bug we are guarding against.
    const event = buildEvent(makeEntry(), makeCard(), []);
    expect(event.start.dateTime.endsWith('Z')).toBe(false);
    expect(event.start.dateTime.includes('+')).toBe(false);
    expect(event.end.dateTime.endsWith('Z')).toBe(false);
    expect(event.end.dateTime.includes('+')).toBe(false);
  });

  it('handles midnight start (00:00 wall-clock)', () => {
    const event = buildEvent(
      makeEntry({ date: '2026-05-15', startMinutes: 0, durationMin: 60 }),
      makeCard(),
      [],
    );
    expect(event.start.dateTime).toBe('2026-05-15T00:00:00');
    expect(event.end.dateTime).toBe('2026-05-15T01:00:00');
  });

  it('handles end-at-23:59 boundary (no past-midnight overflow in v2)', () => {
    // startMinutes 1380 (23:00) + durationMin 59 → end 23:59
    const event = buildEvent(
      makeEntry({ date: '2026-05-15', startMinutes: 1380, durationMin: 59 }),
      makeCard(),
      [],
    );
    expect(event.start.dateTime).toBe('2026-05-15T23:00:00');
    expect(event.end.dateTime).toBe('2026-05-15T23:59:00');
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
      monthlyTotal: null,
    });
    const event = buildEvent(makeEntry({ durationMin: 165 }), card, []);
    expect(event.description).toContain('Rate: Fixed total: 500 EUR (proportional split)');
  });

  // S21: monthly retainer card. The description must explicitly name the
  // monthly model — falling through to the "Fixed total: 0 EUR" copy would
  // be wrong on every monthly-card calendar event.
  it('description rate line for monthly card uses the "Monthly total" copy', () => {
    const card = makeCard({
      rateType: 'monthly',
      hourlyRate: null,
      fixedTotal: null,
      monthlyTotal: 250,
    });
    const event = buildEvent(makeEntry({ durationMin: 165 }), card, []);
    expect(event.description).toContain('Rate: Monthly total: 250 EUR');
    // Per-entry earnings for a monthly card are 0 (the retainer is billed
    // at period scope, not per entry). The GC description's Earnings line
    // therefore renders 0.00 EUR — that's correct.
    expect(event.description).toContain('Earnings: 0.00 EUR');
  });

  it('description rate line for monthly card with null monthlyTotal falls back to "0 EUR"', () => {
    // Defensive: a malformed monthly row still emits a stable description
    // line instead of crashing or leaking "undefined EUR".
    const card = makeCard({
      rateType: 'monthly',
      hourlyRate: null,
      fixedTotal: null,
      monthlyTotal: null,
    });
    const event = buildEvent(makeEntry({ durationMin: 60 }), card, []);
    expect(event.description).toContain('Rate: Monthly total: 0 EUR');
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
    // S19 palette → GC colorId, locked mapping per CARD_COLORS spec.
    expect(buildEvent(makeEntry(), makeCard({ color: '#DC2626' }), []).colorId).toBe('11'); // Tomato
    expect(buildEvent(makeEntry(), makeCard({ color: '#2563EB' }), []).colorId).toBe('9'); // Blueberry
    expect(buildEvent(makeEntry(), makeCard({ color: '#D97706' }), []).colorId).toBe('6'); // Tangerine (amber)
    // The deliberate Tangerine collision: #EA580C (Orange) also maps to '6'.
    expect(buildEvent(makeEntry(), makeCard({ color: '#EA580C' }), []).colorId).toBe('6');
  });

  it('falls back to colorId "8" for off-palette colors (defensive)', () => {
    const event = buildEvent(makeEntry(), makeCard({ color: '#123456' }), []);
    expect(event.colorId).toBe('8');
  });

  describe('defensive shape checks', () => {
    // These guard against legacy / corrupted entries reaching the Calendar
    // wire. Without them a bogus startMinutes silently produces NaN inside
    // date-fns and Google rejects the request with a generic "Invalid start
    // time." 400 that's much harder to triage.
    it('throws on non-integer startMinutes', () => {
      expect(() =>
        buildEvent(makeEntry({ startMinutes: NaN as unknown as number }), makeCard(), []),
      ).toThrow(/invalid startMinutes/);
    });

    it('throws on negative startMinutes', () => {
      expect(() => buildEvent(makeEntry({ startMinutes: -1 }), makeCard(), [])).toThrow(
        /invalid startMinutes/,
      );
    });

    it('throws on startMinutes >= 1440', () => {
      expect(() => buildEvent(makeEntry({ startMinutes: 1440 }), makeCard(), [])).toThrow(
        /invalid startMinutes/,
      );
    });

    it('throws on zero or negative durationMin', () => {
      expect(() => buildEvent(makeEntry({ durationMin: 0 }), makeCard(), [])).toThrow(
        /invalid durationMin/,
      );
      expect(() => buildEvent(makeEntry({ durationMin: -5 }), makeCard(), [])).toThrow(
        /invalid durationMin/,
      );
    });

    it('throws on start + duration overflow past midnight', () => {
      // 23:00 + 2h would wrap into next day. v2.0 rejects this; v2.1+ may
      // permit it by emitting an end-on-next-day dateTime.
      expect(() =>
        buildEvent(makeEntry({ startMinutes: 1380, durationMin: 120 }), makeCard(), []),
      ).toThrow(/exceeds 1440/);
    });
  });
});
