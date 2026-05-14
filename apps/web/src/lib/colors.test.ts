import { describe, expect, it } from 'vitest';

import { CARD_COLORS, GOOGLE_CALENDAR_COLOR_MAP, isValidCardColor } from './colors';

describe('CARD_COLORS', () => {
  it('has exactly 12 entries', () => {
    expect(CARD_COLORS).toHaveLength(12);
  });

  it('contains the spec hex values in the spec order', () => {
    // PROJECT_PLAN.md §7.5 -- order matters because the index is the public color
    // contract surfaced in the UI palette picker.
    expect(CARD_COLORS).toEqual([
      '#EF4444',
      '#F97316',
      '#EAB308',
      '#22C55E',
      '#10B981',
      '#06B6D4',
      '#3B82F6',
      '#6366F1',
      '#8B5CF6',
      '#EC4899',
      '#78716C',
      '#0F172A',
    ]);
  });

  it('every entry is a unique hex code', () => {
    expect(new Set(CARD_COLORS).size).toBe(CARD_COLORS.length);
  });

  it('every entry has a Google Calendar colorId mapping', () => {
    for (const hex of CARD_COLORS) {
      expect(GOOGLE_CALENDAR_COLOR_MAP[hex]).toBeDefined();
    }
  });

  it('every Google colorId mapping is a string in "1".."11"', () => {
    const ids = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    for (const hex of CARD_COLORS) {
      expect(ids.has(GOOGLE_CALENDAR_COLOR_MAP[hex] as string)).toBe(true);
    }
  });
});

describe('isValidCardColor', () => {
  it('returns true for every hex in CARD_COLORS', () => {
    for (const hex of CARD_COLORS) {
      expect(isValidCardColor(hex)).toBe(true);
    }
  });

  it('returns false for unknown hex values', () => {
    expect(isValidCardColor('#FFFFFF')).toBe(false);
    expect(isValidCardColor('not-a-color')).toBe(false);
    expect(isValidCardColor('')).toBe(false);
  });
});
