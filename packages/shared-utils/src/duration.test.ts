import { describe, expect, it } from 'vitest';

import { formatDuration, parseDuration } from './duration';

describe('formatDuration', () => {
  it('returns "0H 0M" for zero minutes', () => {
    expect(formatDuration(0)).toBe('0H 0M');
  });

  it('returns "1H 0M" for exactly one hour (no zero-padding on minutes)', () => {
    expect(formatDuration(60)).toBe('1H 0M');
  });

  it('returns "2H 45M" for 165 minutes', () => {
    expect(formatDuration(165)).toBe('2H 45M');
  });

  it('handles small minute values without zero-padding', () => {
    expect(formatDuration(5)).toBe('0H 5M');
  });

  it('handles large hour values', () => {
    expect(formatDuration(60 * 25 + 30)).toBe('25H 30M');
  });

  it('always uses uppercase H and M markers and a single space', () => {
    expect(formatDuration(75)).toBe('1H 15M');
    expect(formatDuration(75)).not.toBe('1h 15m');
    expect(formatDuration(75)).not.toBe('1H15M');
  });
});

describe('parseDuration', () => {
  it('converts hours + minutes into total minutes', () => {
    expect(parseDuration(2, 45)).toBe(165);
  });

  it('handles zero hours', () => {
    expect(parseDuration(0, 30)).toBe(30);
  });

  it('handles zero minutes', () => {
    expect(parseDuration(3, 0)).toBe(180);
  });

  it('round-trips with formatDuration', () => {
    const total = parseDuration(4, 7);
    expect(formatDuration(total)).toBe('4H 7M');
  });
});
