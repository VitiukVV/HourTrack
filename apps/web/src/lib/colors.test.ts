import { describe, expect, it } from 'vitest';

import {
  CARD_COLORS,
  GOOGLE_CALENDAR_COLOR_MAP,
  getReadableTextColor,
  isValidCardColor,
} from './colors';

describe('CARD_COLORS', () => {
  it('has exactly 12 entries', () => {
    expect(CARD_COLORS).toHaveLength(12);
  });

  it('contains the S19 spec hex values in the spec order', () => {
    // PROJECT_PLAN.md §7.5 + S19 spec Part B Task 5 -- order matters because
    // the index is the public color contract surfaced in the UI palette picker.
    expect(CARD_COLORS).toEqual([
      '#DC2626',
      '#EA580C',
      '#D97706',
      '#CA8A04',
      '#65A30D',
      '#16A34A',
      '#0D9488',
      '#0284C7',
      '#2563EB',
      '#7C3AED',
      '#C026D3',
      '#DB2777',
    ]);
  });

  it('every entry is a unique hex code', () => {
    expect(new Set(CARD_COLORS).size).toBe(CARD_COLORS.length);
  });

  it('every entry is a 6-digit hex string', () => {
    for (const hex of CARD_COLORS) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
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
    // Pre-S19 palette hex values that are NOT in the new palette are now
    // invalid — verifies the migration's runtime guard.
    expect(isValidCardColor('#EF4444')).toBe(false);
    expect(isValidCardColor('#3B82F6')).toBe(false);
    expect(isValidCardColor('#0F172A')).toBe(false);
  });
});

describe('getReadableTextColor', () => {
  it('returns one of the two valid foregrounds for every CARD_COLORS hex', () => {
    // Sanity check: for visibly-vivid hues like banana/lime/sky, the picked
    // color should not be black-on-black or white-on-white. We don't pin
    // each swatch's choice (the helper's threshold is allowed to shift if
    // the palette is re-tuned); we just assert the return is one of the
    // two valid foregrounds.
    for (const hex of CARD_COLORS) {
      const fg = getReadableTextColor(hex);
      expect(fg === '#FFFFFF' || fg === '#0F172A').toBe(true);
    }
  });

  it('returns white text on pure black background', () => {
    expect(getReadableTextColor('#000000')).toBe('#FFFFFF');
  });

  it('returns dark text on pure white background', () => {
    expect(getReadableTextColor('#FFFFFF')).toBe('#0F172A');
  });

  it('returns dark text on a near-white pale background', () => {
    expect(getReadableTextColor('#F8FAFC')).toBe('#0F172A');
  });

  it('returns white text on a deep navy background', () => {
    expect(getReadableTextColor('#0F172A')).toBe('#FFFFFF');
  });

  it('returns the safe default for malformed input', () => {
    // The helper is defensive — non-hex input must not throw and must yield
    // a valid foreground so consumers can still render a chip.
    expect(getReadableTextColor('not-a-hex')).toBe('#0F172A');
    expect(getReadableTextColor('#zzz')).toBe('#0F172A');
    expect(getReadableTextColor('')).toBe('#0F172A');
  });

  it('strips an optional leading "#" before parsing', () => {
    expect(getReadableTextColor('000000')).toBe('#FFFFFF');
    expect(getReadableTextColor('FFFFFF')).toBe('#0F172A');
  });
});
