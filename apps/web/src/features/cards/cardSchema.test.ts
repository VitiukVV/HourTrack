import { describe, expect, it } from 'vitest';

import { CARD_COLORS } from '@/lib/colors';
import { CardInputSchema } from './cardSchema';

// The schema is a discriminated union, so we type the test inputs as a flat
// shape (with all three rate fields nullable) for ergonomic spreading in
// tests. safeParse coerces to the proper variant. S21 extended this with the
// `'monthly'` rateType + `monthlyTotal` field.
interface FlatInput {
  name: string;
  color: string;
  defaultDurationMin: number;
  defaultStartMinutes: number;
  rateType: 'hourly' | 'fixed' | 'monthly';
  hourlyRate: number | null;
  fixedTotal: number | null;
  monthlyTotal: number | null;
  defaultNote: string | null;
}

function baseHourlyInput(overrides: Partial<FlatInput> = {}): FlatInput {
  return {
    name: 'Raquel',
    color: '#2563EB',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    ...overrides,
  };
}

function baseFixedInput(overrides: Partial<FlatInput> = {}): FlatInput {
  return {
    name: 'Manuel',
    color: '#DC2626',
    defaultDurationMin: 240,
    defaultStartMinutes: 600,
    rateType: 'fixed',
    hourlyRate: null,
    fixedTotal: 1200,
    monthlyTotal: null,
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

  it('accepts defaultDurationMin of 0 (S19: create-mode seed)', () => {
    // S19 Task 3 relaxed the lower bound from 1 to 0 so the create form's
    // seeded `hours=0, minutes=0` state parses cleanly. Users still need
    // to type a non-zero duration in practice; the schema no longer
    // rejects the initial state outright.
    const result = CardInputSchema.safeParse(baseHourlyInput({ defaultDurationMin: 0 }));
    expect(result.success).toBe(true);
  });

  it('rejects defaultDurationMin of -1 (below the min boundary)', () => {
    const result = CardInputSchema.safeParse(baseHourlyInput({ defaultDurationMin: -1 }));
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

  // S16 -- defaultStartMinutes (minutes since local midnight) is required
  // and must be an integer in [0, 1439]. Invalid values use the i18n key
  // `cards.validation.defaultStartMinutesRange`.
  describe('S16 — defaultStartMinutes', () => {
    it('accepts the midnight boundary (0)', () => {
      const result = CardInputSchema.safeParse(baseHourlyInput({ defaultStartMinutes: 0 }));
      expect(result.success).toBe(true);
    });

    it('accepts the upper boundary (1439)', () => {
      const result = CardInputSchema.safeParse(baseHourlyInput({ defaultStartMinutes: 1439 }));
      expect(result.success).toBe(true);
    });

    it('round-trips a typical value (600 = 10:00)', () => {
      const result = CardInputSchema.safeParse(baseHourlyInput({ defaultStartMinutes: 600 }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultStartMinutes).toBe(600);
      }
    });

    it('rejects -1 with the defaultStartMinutesRange i18n key', () => {
      const result = CardInputSchema.safeParse(baseHourlyInput({ defaultStartMinutes: -1 }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain(
          'cards.validation.defaultStartMinutesRange',
        );
      }
    });

    it('rejects 1440 with the defaultStartMinutesRange i18n key', () => {
      const result = CardInputSchema.safeParse(baseHourlyInput({ defaultStartMinutes: 1440 }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain(
          'cards.validation.defaultStartMinutesRange',
        );
      }
    });

    it('rejects a non-integer (10.5) with the defaultStartMinutesRange i18n key', () => {
      const result = CardInputSchema.safeParse(baseHourlyInput({ defaultStartMinutes: 10.5 }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain(
          'cards.validation.defaultStartMinutesRange',
        );
      }
    });

    it('rejects a missing field (required, no implicit default)', () => {
      const { defaultStartMinutes: _omit, ...rest } = baseHourlyInput();
      const result = CardInputSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });
  });

  // S21 — monthly retainer cards. The discriminated union adds a third
  // branch with `monthlyTotal` non-null / positive + both other rate
  // fields null.
  describe('S21 — monthly rate type', () => {
    function baseMonthlyInput(overrides: Partial<FlatInput> = {}): FlatInput {
      return {
        name: 'Mary',
        color: '#2563EB',
        defaultDurationMin: 0,
        defaultStartMinutes: 540,
        rateType: 'monthly',
        hourlyRate: null,
        fixedTotal: null,
        monthlyTotal: 250,
        defaultNote: null,
        ...overrides,
      };
    }

    it('accepts a minimal valid monthly card', () => {
      const result = CardInputSchema.safeParse(baseMonthlyInput());
      expect(result.success).toBe(true);
    });

    it('rejects monthly card with null monthlyTotal', () => {
      const result = CardInputSchema.safeParse(baseMonthlyInput({ monthlyTotal: null }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain('monthlyTotalRequired');
      }
    });

    it('rejects monthly card with zero or negative monthlyTotal', () => {
      expect(CardInputSchema.safeParse(baseMonthlyInput({ monthlyTotal: 0 })).success).toBe(false);
      expect(CardInputSchema.safeParse(baseMonthlyInput({ monthlyTotal: -10 })).success).toBe(
        false,
      );
    });

    it('rejects monthly card with non-null hourlyRate (invariant)', () => {
      const result = CardInputSchema.safeParse(baseMonthlyInput({ hourlyRate: 20 }));
      expect(result.success).toBe(false);
    });

    it('rejects monthly card with non-null fixedTotal (invariant)', () => {
      const result = CardInputSchema.safeParse(baseMonthlyInput({ fixedTotal: 500 }));
      expect(result.success).toBe(false);
    });

    it('rejects hourly card with non-null monthlyTotal (invariant)', () => {
      const result = CardInputSchema.safeParse(baseHourlyInput({ monthlyTotal: 250 }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain('monthlyTotalNotNull');
      }
    });

    it('rejects fixed card with non-null monthlyTotal (invariant)', () => {
      const result = CardInputSchema.safeParse(baseFixedInput({ monthlyTotal: 250 }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain('monthlyTotalNotNull');
      }
    });
  });
});
