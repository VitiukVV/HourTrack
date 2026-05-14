import { describe, expect, it } from 'vitest';

import { CARD_COLORS } from '@/lib/colors';
import { CardInputSchema } from './cardSchema';

// The schema is a discriminated union, so we type the test inputs as a flat
// shape (with both rate fields nullable) for ergonomic spreading in tests.
// safeParse coerces to the proper variant.
interface FlatInput {
  name: string;
  color: string;
  defaultDurationMin: number;
  rateType: 'hourly' | 'fixed';
  hourlyRate: number | null;
  fixedTotal: number | null;
  defaultNote: string | null;
}

function baseHourlyInput(overrides: Partial<FlatInput> = {}): FlatInput {
  return {
    name: 'Raquel',
    color: '#3B82F6',
    defaultDurationMin: 480,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    defaultNote: null,
    ...overrides,
  };
}

function baseFixedInput(overrides: Partial<FlatInput> = {}): FlatInput {
  return {
    name: 'Manuel',
    color: '#EF4444',
    defaultDurationMin: 240,
    rateType: 'fixed',
    hourlyRate: null,
    fixedTotal: 1200,
    defaultNote: null,
    ...overrides,
  };
}

describe('CardInputSchema', () => {
  it('accepts a minimal valid hourly card', () => {
    const result = CardInputSchema.safeParse(baseHourlyInput());
    expect(result.success).toBe(true);
  });

  it('accepts a minimal valid fixed-total card', () => {
    const result = CardInputSchema.safeParse(baseFixedInput());
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = CardInputSchema.safeParse(baseHourlyInput({ name: '' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'name')).toBe(true);
    }
  });

  it('rejects name longer than 60 characters', () => {
    const result = CardInputSchema.safeParse(baseHourlyInput({ name: 'x'.repeat(61) }));
    expect(result.success).toBe(false);
  });

  it('rejects color not in palette', () => {
    const result = CardInputSchema.safeParse(baseHourlyInput({ color: '#123456' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'color')).toBe(true);
    }
  });

  it('accepts every preset color in CARD_COLORS', () => {
    for (const hex of CARD_COLORS) {
      const result = CardInputSchema.safeParse(baseHourlyInput({ color: hex }));
      expect(result.success).toBe(true);
    }
  });

  it('rejects hourly card with null hourlyRate', () => {
    const result = CardInputSchema.safeParse(baseHourlyInput({ hourlyRate: null }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('hourlyRate'))).toBe(true);
    }
  });

  it('rejects hourly card with zero or negative hourlyRate', () => {
    expect(CardInputSchema.safeParse(baseHourlyInput({ hourlyRate: 0 })).success).toBe(false);
    expect(CardInputSchema.safeParse(baseHourlyInput({ hourlyRate: -5 })).success).toBe(false);
  });

  it('rejects fixed card with null fixedTotal', () => {
    const result = CardInputSchema.safeParse(baseFixedInput({ fixedTotal: null }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('fixedTotal'))).toBe(true);
    }
  });

  it('rejects fixed card with zero or negative fixedTotal', () => {
    expect(CardInputSchema.safeParse(baseFixedInput({ fixedTotal: 0 })).success).toBe(false);
    expect(CardInputSchema.safeParse(baseFixedInput({ fixedTotal: -100 })).success).toBe(false);
  });

  it('rejects defaultDurationMin of 0', () => {
    const result = CardInputSchema.safeParse(baseHourlyInput({ defaultDurationMin: 0 }));
    expect(result.success).toBe(false);
  });

  it('rejects defaultDurationMin > 1440', () => {
    const result = CardInputSchema.safeParse(baseHourlyInput({ defaultDurationMin: 1441 }));
    expect(result.success).toBe(false);
  });

  it('rejects defaultNote longer than 500 chars', () => {
    const result = CardInputSchema.safeParse(baseHourlyInput({ defaultNote: 'x'.repeat(501) }));
    expect(result.success).toBe(false);
  });

  it('accepts null defaultNote', () => {
    const result = CardInputSchema.safeParse(baseHourlyInput({ defaultNote: null }));
    expect(result.success).toBe(true);
  });

  it('accepts empty string defaultNote', () => {
    const result = CardInputSchema.safeParse(baseHourlyInput({ defaultNote: '' }));
    expect(result.success).toBe(true);
  });

  it('rejects hourly card with non-null fixedTotal (invariant)', () => {
    const result = CardInputSchema.safeParse(baseHourlyInput({ fixedTotal: 500 }));
    expect(result.success).toBe(false);
  });

  it('rejects fixed card with non-null hourlyRate (invariant)', () => {
    const result = CardInputSchema.safeParse(baseFixedInput({ hourlyRate: 20 }));
    expect(result.success).toBe(false);
  });
});
