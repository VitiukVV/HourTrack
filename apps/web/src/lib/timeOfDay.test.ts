import { describe, expect, it } from 'vitest';

import { minutesToHHMM, parseHHMM } from './timeOfDay';

describe('minutesToHHMM', () => {
  it('round-trips 600 to 10:00', () => {
    expect(minutesToHHMM(600)).toBe('10:00');
  });

  it('zero-pads both hours and minutes', () => {
    expect(minutesToHHMM(0)).toBe('00:00');
    expect(minutesToHHMM(9)).toBe('00:09');
    expect(minutesToHHMM(60)).toBe('01:00');
    expect(minutesToHHMM(125)).toBe('02:05');
  });

  it('handles the upper boundary (1439 = 23:59)', () => {
    expect(minutesToHHMM(1439)).toBe('23:59');
  });

  it('clamps out-of-range values rather than crashing', () => {
    // Negative wraps to 00:00; over-range wraps to 23:59. The form layer
    // is responsible for proper validation; this is defense-in-depth so a
    // stale prop never throws inside the input.
    expect(minutesToHHMM(-30)).toBe('00:00');
    expect(minutesToHHMM(1500)).toBe('23:59');
  });

  it('truncates fractional inputs to whole minutes', () => {
    expect(minutesToHHMM(60.9)).toBe('01:00');
  });

  it('falls back to 00:00 for non-finite inputs', () => {
    expect(minutesToHHMM(Number.NaN)).toBe('00:00');
    expect(minutesToHHMM(Number.POSITIVE_INFINITY)).toBe('00:00');
  });
});

describe('parseHHMM', () => {
  it('round-trips 10:00 back to 600', () => {
    expect(parseHHMM('10:00')).toBe(600);
  });

  it('accepts zero-padded and one-digit hour forms', () => {
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('1:30')).toBe(90);
    expect(parseHHMM('23:59')).toBe(1439);
  });

  it('returns null for empty / unparseable inputs', () => {
    expect(parseHHMM('')).toBeNull();
    expect(parseHHMM('not-a-time')).toBeNull();
    expect(parseHHMM('10:60')).toBeNull(); // minute out of range
    expect(parseHHMM('25:00')).toBeNull(); // hour out of range
    expect(parseHHMM('10')).toBeNull(); // no colon
  });
});
