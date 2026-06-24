import { describe, expect, it } from 'vitest';

import { EntryEditorSchema } from './entrySchema';

/**
 * The entry-editor form has 6 logical fields exposed to the user (5 pre-S16,
 * + `startMinutes` from S16):
 *   hours, minutes, startMinutes, useCustomPayment, customPayment, note.
 *
 * The schema mirrors the same "validate-then-collapse" pattern used by
 * `cardSchema.ts` (S03). After parse, the caller gets `{ durationMin,
 * startMinutes, useCustomPayment, customPayment, note }` — the wire shape
 * consumed by `useUpdateEntryMutation`. `hours`/`minutes` collapse into
 * `durationMin` via `parseDuration`; `startMinutes` passes through.
 */

describe('EntryEditorSchema', () => {
  it('accepts a valid hourly entry (no custom payment, with note)', () => {
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: 2,
      minutes: 45,
      startMinutes: 600,
      useCustomPayment: false,
      customPayment: null,
      note: 'Did stuff',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.durationMin).toBe(165);
      expect(result.data.startMinutes).toBe(600);
      expect(result.data.useCustomPayment).toBe(false);
      expect(result.data.customPayment).toBeNull();
      expect(result.data.note).toBe('Did stuff');
    }
  });

  describe('S25 — date field (UR-25-4)', () => {
    const base = {
      hours: 2,
      minutes: 0,
      startMinutes: 600,
      useCustomPayment: false,
      customPayment: null,
      note: null,
    };

    it('passes the date through to the parsed output', () => {
      const result = EntryEditorSchema.safeParse({ ...base, date: '2026-06-01' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.date).toBe('2026-06-01');
    });

    it('rejects a malformed date with the dateInvalid key', () => {
      for (const bad of ['2026/06/01', 'nope', '', '2026-6-1']) {
        const result = EntryEditorSchema.safeParse({ ...base, date: bad });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(
            result.error.issues.some((i) => i.message === 'entries.validation.dateInvalid'),
          ).toBe(true);
        }
      }
    });

    it('rejects a missing date', () => {
      const result = EntryEditorSchema.safeParse(base);
      expect(result.success).toBe(false);
    });
  });

  it('accepts a valid custom-payment entry', () => {
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: 0,
      minutes: 30,
      startMinutes: 600,
      useCustomPayment: true,
      customPayment: 50,
      note: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.durationMin).toBe(30);
      expect(result.data.useCustomPayment).toBe(true);
      expect(result.data.customPayment).toBe(50);
    }
  });

  it('accepts max boundary values (h=23, m=59) with a 00:00 start', () => {
    // S16: with startMinutes=0 and duration=23h59m, the window ends at
    // 23:59 inclusive — still within the [0, 1440] day-bound. Asserting
    // here that the boundary case stays acceptable.
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: 23,
      minutes: 59,
      startMinutes: 0,
      useCustomPayment: false,
      customPayment: null,
      note: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.durationMin).toBe(23 * 60 + 59);
    }
  });

  it('rejects hours > 23', () => {
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: 24,
      minutes: 0,
      startMinutes: 600,
      useCustomPayment: false,
      customPayment: null,
      note: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('entries.validation.hoursRange');
    }
  });

  it('rejects hours < 0', () => {
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: -1,
      minutes: 0,
      startMinutes: 600,
      useCustomPayment: false,
      customPayment: null,
      note: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects minutes > 59', () => {
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: 1,
      minutes: 60,
      startMinutes: 600,
      useCustomPayment: false,
      customPayment: null,
      note: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('entries.validation.minutesRange');
    }
  });

  it('rejects total durationMin === 0 (both hours and minutes zero)', () => {
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: 0,
      minutes: 0,
      startMinutes: 600,
      useCustomPayment: false,
      customPayment: null,
      note: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('entries.validation.durationPositive');
    }
  });

  it('rejects useCustomPayment=true with null customPayment', () => {
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: 2,
      minutes: 0,
      startMinutes: 600,
      useCustomPayment: true,
      customPayment: null,
      note: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain(
        'entries.validation.customPaymentNonNegative',
      );
    }
  });

  it('rejects useCustomPayment=true with negative customPayment', () => {
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: 1,
      minutes: 0,
      startMinutes: 600,
      useCustomPayment: true,
      customPayment: -10,
      note: null,
    });
    expect(result.success).toBe(false);
  });

  it('accepts useCustomPayment=true with customPayment=0 (zero is non-negative)', () => {
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: 1,
      minutes: 0,
      startMinutes: 600,
      useCustomPayment: true,
      customPayment: 0,
      note: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customPayment).toBe(0);
    }
  });

  it('normalises empty-string note to null', () => {
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: 1,
      minutes: 0,
      startMinutes: 600,
      useCustomPayment: false,
      customPayment: null,
      note: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBeNull();
    }
  });

  it('rejects note longer than 500 chars', () => {
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: 1,
      minutes: 0,
      startMinutes: 600,
      useCustomPayment: false,
      customPayment: null,
      note: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('entries.validation.noteTooLong');
    }
  });

  it('drops customPayment when useCustomPayment is false (always null in output)', () => {
    const result = EntryEditorSchema.safeParse({
      date: '2026-05-14',
      hours: 1,
      minutes: 0,
      startMinutes: 600,
      useCustomPayment: false,
      customPayment: 999, // user toggled off — input had stale value
      note: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customPayment).toBeNull();
    }
  });

  // S16 -- the new `startMinutes` field carries minutes since local
  // midnight `[0, 1439]` and must satisfy the cross-field invariant
  // `startMinutes + (hours*60 + minutes) <= 1440` (no past-midnight wrap
  // in v2).
  describe('S16 — startMinutes range', () => {
    it('accepts the midnight boundary (0)', () => {
      const result = EntryEditorSchema.safeParse({
        date: '2026-05-14',
        hours: 1,
        minutes: 0,
        startMinutes: 0,
        useCustomPayment: false,
        customPayment: null,
        note: null,
      });
      expect(result.success).toBe(true);
    });

    it('accepts 1439 (23:59 start) with a tiny duration', () => {
      // 1439 + (0*60 + 1) = 1440 — exactly equal to the day boundary, OK.
      const result = EntryEditorSchema.safeParse({
        date: '2026-05-14',
        hours: 0,
        minutes: 1,
        startMinutes: 1439,
        useCustomPayment: false,
        customPayment: null,
        note: null,
      });
      expect(result.success).toBe(true);
    });

    it('rejects -1 with the startMinutesRange i18n key', () => {
      const result = EntryEditorSchema.safeParse({
        date: '2026-05-14',
        hours: 1,
        minutes: 0,
        startMinutes: -1,
        useCustomPayment: false,
        customPayment: null,
        note: null,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain(
          'entries.validation.startMinutesRange',
        );
      }
    });

    it('rejects 1440 with the startMinutesRange i18n key', () => {
      const result = EntryEditorSchema.safeParse({
        date: '2026-05-14',
        hours: 0,
        minutes: 30,
        startMinutes: 1440,
        useCustomPayment: false,
        customPayment: null,
        note: null,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain(
          'entries.validation.startMinutesRange',
        );
      }
    });

    it('rejects a non-integer', () => {
      const result = EntryEditorSchema.safeParse({
        date: '2026-05-14',
        hours: 1,
        minutes: 0,
        startMinutes: 600.5,
        useCustomPayment: false,
        customPayment: null,
        note: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects a missing field (required, no implicit default)', () => {
      const result = EntryEditorSchema.safeParse({
        date: '2026-05-14',
        hours: 1,
        minutes: 0,
        useCustomPayment: false,
        customPayment: null,
        note: null,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('S16 — cross-field overflow (startMinutes + duration <= 1440)', () => {
    it('rejects start 1380 (23:00) + 60 min (== 1440 + 0 = 1440? no — 1440 > 1440? equal is OK; this should be 1380 + 61 = 1441)', () => {
      // The acceptance criterion in the sprint spec uses `>= 1440` as the
      // threshold name but the schema rule is `> 1440`, i.e. `<= 1440` is
      // OK. So a 1380 + 60-minute window lands at exactly 1440 — accepted.
      const okAt1440 = EntryEditorSchema.safeParse({
        date: '2026-05-14',
        hours: 1,
        minutes: 0,
        startMinutes: 1380,
        useCustomPayment: false,
        customPayment: null,
        note: null,
      });
      expect(okAt1440.success).toBe(true);
      // One minute past, however, must fail.
      const overflow = EntryEditorSchema.safeParse({
        date: '2026-05-14',
        hours: 1,
        minutes: 1,
        startMinutes: 1380,
        useCustomPayment: false,
        customPayment: null,
        note: null,
      });
      expect(overflow.success).toBe(false);
      if (!overflow.success) {
        expect(JSON.stringify(overflow.error.issues)).toContain('entries.validation.timeOverflow');
      }
    });

    it('accepts start 1380 + 59 min = 1439 (within the day)', () => {
      const result = EntryEditorSchema.safeParse({
        date: '2026-05-14',
        hours: 0,
        minutes: 59,
        startMinutes: 1380,
        useCustomPayment: false,
        customPayment: null,
        note: null,
      });
      expect(result.success).toBe(true);
    });

    it('accepts midnight start (0) regardless of duration up to 23h59m', () => {
      const result = EntryEditorSchema.safeParse({
        date: '2026-05-14',
        hours: 23,
        minutes: 59,
        startMinutes: 0,
        useCustomPayment: false,
        customPayment: null,
        note: null,
      });
      expect(result.success).toBe(true);
    });

    it('attaches the timeOverflow issue to the `startMinutes` path (so UI can highlight it)', () => {
      const result = EntryEditorSchema.safeParse({
        date: '2026-05-14',
        hours: 2,
        minutes: 0,
        startMinutes: 1320, // 22:00 + 2:00 = 24:00 → equal, OK; bump to 1321 to overflow
        useCustomPayment: false,
        customPayment: null,
        note: null,
      });
      expect(result.success).toBe(true);

      const result2 = EntryEditorSchema.safeParse({
        date: '2026-05-14',
        hours: 2,
        minutes: 1,
        startMinutes: 1320,
        useCustomPayment: false,
        customPayment: null,
        note: null,
      });
      expect(result2.success).toBe(false);
      if (!result2.success) {
        const overflowIssue = result2.error.issues.find((i) =>
          i.message.includes('entries.validation.timeOverflow'),
        );
        expect(overflowIssue).toBeDefined();
        expect(overflowIssue!.path).toContain('startMinutes');
      }
    });
  });
});
