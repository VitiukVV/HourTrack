import { describe, expect, it } from 'vitest';

import {
  CARD_COLORS,
  GOOGLE_CALENDAR_COLOR_MAP,
  getLabelContrast,
  getReadableTextColor,
  isValidCardColor,
  isValidHexColor,
  resolveCalendarColorId,
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
      '#0C74B0',
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
    // Kept as a shape check. The per-preset choice is no longer free to
    // shift: it is pinned below in "getReadableTextColor — contrast-ratio
    // rule", because the label is now derived from a measured ratio rather
    // than a tunable threshold.
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

// ---------------------------------------------------------------------------
// 001-cards-order-colors — contrast-ratio label rule, hex validation and the
// nearest-Calendar-colour resolution. See specs/001-cards-order-colors/
// research.md D5/D6 for the measured basis of every number pinned here.
// ---------------------------------------------------------------------------

/** WCAG relative luminance, computed independently of the implementation. */
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const channel = (i: number) => {
    const s = parseInt(n.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio, computed independently of the implementation. */
function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

describe('getReadableTextColor — contrast-ratio rule', () => {
  // The label the ratio rule picks for each preset. Seven of these flip from
  // the pre-feature luminance-threshold rule (orange, amber, banana, lime,
  // basil, teal) — a deliberate, user-approved visible change (FR-010b).
  const EXPECTED_LABEL: Record<string, '#FFFFFF' | '#0F172A'> = {
    '#DC2626': '#FFFFFF',
    '#EA580C': '#0F172A',
    '#D97706': '#0F172A',
    '#CA8A04': '#0F172A',
    '#65A30D': '#0F172A',
    '#16A34A': '#0F172A',
    '#0D9488': '#0F172A',
    '#0C74B0': '#FFFFFF',
    '#2563EB': '#FFFFFF',
    '#7C3AED': '#FFFFFF',
    '#C026D3': '#FFFFFF',
    '#DB2777': '#FFFFFF',
  };

  it('picks the documented label for every preset', () => {
    for (const hex of CARD_COLORS) {
      expect(getReadableTextColor(hex)).toBe(EXPECTED_LABEL[hex]);
    }
  });

  it('picks whichever label actually has the higher contrast ratio', () => {
    for (const hex of CARD_COLORS) {
      const white = contrast(hex, '#FFFFFF');
      const dark = contrast(hex, '#0F172A');
      expect(getReadableTextColor(hex)).toBe(dark > white ? '#0F172A' : '#FFFFFF');
    }
  });

  it('reaches at least 4.5:1 on every preset — SC-004', () => {
    for (const hex of CARD_COLORS) {
      expect(contrast(hex, getReadableTextColor(hex))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('flips to dark text on the seven mid-tone presets', () => {
    // Regression cage for FR-010b: if someone restores the luminance
    // threshold, these six-plus-one go back to white and the row silently
    // becomes less readable again.
    for (const hex of ['#EA580C', '#D97706', '#CA8A04', '#65A30D', '#16A34A', '#0D9488']) {
      expect(getReadableTextColor(hex)).toBe('#0F172A');
    }
  });
});

describe('getLabelContrast', () => {
  it('returns the chosen label together with its ratio', () => {
    const sky = getLabelContrast('#0C74B0');
    expect(sky.color).toBe('#FFFFFF');
    expect(sky.ratio).toBeCloseTo(5.07, 1);
  });

  it('agrees with getReadableTextColor for every preset', () => {
    for (const hex of CARD_COLORS) {
      expect(getLabelContrast(hex).color).toBe(getReadableTextColor(hex));
    }
  });

  it('reports a sub-threshold ratio for a mid-tone colour no label can rescue', () => {
    // The retired sky blue is the worked example from research.md D5: 4.10
    // against white, 4.36 against dark, so its best is still under 4.5.
    const retired = getLabelContrast('#0284C7');
    expect(retired.ratio).toBeLessThan(4.5);
    expect(retired.ratio).toBeCloseTo(4.36, 1);
  });

  it('returns the safe default and a computable ratio for malformed input', () => {
    const bad = getLabelContrast('not-a-hex');
    expect(bad.color).toBe('#0F172A');
    expect(bad.ratio).toBeGreaterThan(0);
  });
});

describe('isValidHexColor', () => {
  it('accepts 6-digit hex in either case', () => {
    expect(isValidHexColor('#0C74B0')).toBe(true);
    expect(isValidHexColor('#0c74b0')).toBe(true);
    expect(isValidHexColor('#AbCdEf')).toBe(true);
  });

  it('rejects everything that is not a 6-digit hex with a leading #', () => {
    expect(isValidHexColor('0C74B0')).toBe(false);
    expect(isValidHexColor('#ABC')).toBe(false);
    expect(isValidHexColor('#0C74B0F')).toBe(false);
    expect(isValidHexColor('rgb(12, 116, 176)')).toBe(false);
    expect(isValidHexColor('rebeccapurple')).toBe(false);
    expect(isValidHexColor('')).toBe(false);
    expect(isValidHexColor('#GGGGGG')).toBe(false);
  });

  it('accepts every preset', () => {
    for (const hex of CARD_COLORS) {
      expect(isValidHexColor(hex)).toBe(true);
    }
  });
});

describe('resolveCalendarColorId', () => {
  it('returns the curated mapping for every preset', () => {
    for (const hex of CARD_COLORS) {
      expect(resolveCalendarColorId(hex)).toBe(GOOGLE_CALENDAR_COLOR_MAP[hex]);
    }
  });

  it('keeps the three deliberate collisions', () => {
    expect(resolveCalendarColorId('#EA580C')).toBe(resolveCalendarColorId('#D97706')); // '6'
    expect(resolveCalendarColorId('#0D9488')).toBe(resolveCalendarColorId('#0C74B0')); // '7'
    expect(resolveCalendarColorId('#7C3AED')).toBe(resolveCalendarColorId('#C026D3')); // '3'
  });

  it('resolves the retired sky blue to Peacock, so an un-upgraded device keeps its colour', () => {
    // '#0284C7' is no longer a preset, so it falls through to nearest
    // neighbour — which must still land on '7' (contracts/card-colour.md).
    expect(resolveCalendarColorId('#0284C7')).toBe('7');
  });

  it('resolves a custom colour to the nearest Google event colour, never grey by default', () => {
    expect(resolveCalendarColorId('#8E24AA')).toBe('3'); // exactly Grape
    expect(resolveCalendarColorId('#33B679')).toBe('2'); // exactly Sage
    expect(resolveCalendarColorId('#FF0000')).toBe('11'); // Tomato is nearest
    expect(resolveCalendarColorId('#0B8043')).toBe('10'); // exactly Basil
  });

  it('may return the slots the curated map leaves unused', () => {
    // Lavender ('1') and Graphite ('8') are deliberately unused by the
    // preset map, but a custom colour that really is closest to them must
    // resolve there rather than to a vivid neighbour.
    expect(resolveCalendarColorId('#7986CB')).toBe('1');
    expect(resolveCalendarColorId('#616161')).toBe('8');
  });

  it('always returns a colorId in "1".."11"', () => {
    const ids = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    for (const hex of ['#123456', '#FFFFFF', '#000000', '#8899AA', '#0C74B0', '#ABCDEF']) {
      expect(ids.has(resolveCalendarColorId(hex))).toBe(true);
    }
  });

  it('falls back to graphite for malformed input', () => {
    expect(resolveCalendarColorId('not-a-hex')).toBe('8');
    expect(resolveCalendarColorId('')).toBe('8');
  });

  // A hex is a hex whatever its case: `#0d9488` and `#0D9488` are the same
  // colour, so they MUST reach the same Calendar slot. The curated map is
  // keyed by the uppercase presets, so a case-sensitive lookup silently
  // dropped a lowercase preset into the nearest-neighbour path instead --
  // which is not merely approximate, it is wrong: basil and lime swapped
  // places and teal landed on sage. Lowercase reaches here from a restored
  // or hand-edited snapshot (neither `assertCardShape` nor the snapshot
  // parser normalises case) and from any custom colour the native picker
  // produced, since `<input type="color">` yields lowercase.
  it('is case-insensitive for every preset', () => {
    for (const hex of CARD_COLORS) {
      expect(resolveCalendarColorId(hex.toLowerCase())).toBe(resolveCalendarColorId(hex));
    }
  });

  it('keeps the curated slot for a lowercase preset rather than approximating it', () => {
    // The three that actually drifted, spelled out so a regression names itself.
    expect(resolveCalendarColorId('#0d9488')).toBe('7'); // Teal -> Peacock, not Sage
    expect(resolveCalendarColorId('#16a34a')).toBe('10'); // Basil -> Basil, not Sage
    expect(resolveCalendarColorId('#65a30d')).toBe('2'); // Lime -> Sage, not Basil
  });
});
