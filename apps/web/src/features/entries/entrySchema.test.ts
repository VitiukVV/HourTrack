import { describe, expect, it } from 'vitest';

import { EntryEditorSchema } from './entrySchema';

/**
 * The entry-editor form has 5 logical fields exposed to the user:
 *   hours, minutes, useCustomPayment, customPayment, note.
 *
 * The schema mirrors the same "validate-then-collapse" pattern used by
 * `cardSchema.ts` (S03). After parse, the caller gets `{ durationMin,
 * useCustomPayment, customPayment, note }` — the wire shape consumed by
 * `useUpdateEntryMutation`. `hours`/`minutes` collapse into `durationMin`
 * via `parseDuration`.
 */

describe('EntryEditorSchema', () => {
  it('accepts a valid hourly entry (no custom payment, with note)', () => {
    const result = EntryEditorSchema.safeParse({
      hours: 2,
      minutes: 45,
      useCustomPayment: false,
      customPayment: null,
      note: 'Did stuff',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.durationMin).toBe(165);
      expect(result.data.useCustomPayment).toBe(false);
      expect(result.data.customPayment).toBeNull();
      expect(result.data.note).toBe('Did stuff');
    }
  });

  it('accepts a valid custom-payment entry', () => {
    const result = EntryEditorSchema.safeParse({
      hours: 0,
      minutes: 30,
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

  it('accepts max boundary values (h=23, m=59)', () => {
    const result = EntryEditorSchema.safeParse({
      hours: 23,
      minutes: 59,
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
      hours: 24,
      minutes: 0,
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
      hours: -1,
      minutes: 0,
      useCustomPayment: false,
      customPayment: null,
      note: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects minutes > 59', () => {
    const result = EntryEditorSchema.safeParse({
      hours: 1,
      minutes: 60,
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
      hours: 0,
      minutes: 0,
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
      hours: 2,
      minutes: 0,
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
      hours: 1,
      minutes: 0,
      useCustomPayment: true,
      customPayment: -10,
      note: null,
    });
    expect(result.success).toBe(false);
  });

  it('accepts useCustomPayment=true with customPayment=0 (zero is non-negative)', () => {
    const result = EntryEditorSchema.safeParse({
      hours: 1,
      minutes: 0,
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
      hours: 1,
      minutes: 0,
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
      hours: 1,
      minutes: 0,
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
      hours: 1,
      minutes: 0,
      useCustomPayment: false,
      customPayment: 999, // user toggled off — input had stale value
      note: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customPayment).toBeNull();
    }
  });
});
