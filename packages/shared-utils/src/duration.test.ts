import { describe, expect, it } from 'vitest';

import { formatDuration, parseDuration } from './duration';

describe('formatDuration', () => {
  it('returns "0h 0m" for zero minutes', () => {
    expect(formatDuration(0)).toBe('0h 0m');
  });

  it('returns "1h 0m" for exactly one hour (no zero-padding on minutes)', () => {
    expect(formatDuration(60)).toBe('1h 0m');
  });

  it('returns "2h 45m" for 165 minutes', () => {
    expect(formatDuration(165)).toBe('2h 45m');
  });

  it('handles small minute values without zero-padding', () => {
    expect(formatDuration(5)).toBe('0h 5m');
  });

  it('handles large hour values', () => {
    expect(formatDuration(60 * 25 + 30)).toBe('25h 30m');
  });

  it('always uses lowercase h and m markers and a single space', () => {
    expect(formatDuration(75)).toBe('1h 15m');
    expect(formatDuration(75)).not.toBe('1H 15M');
    expect(formatDuration(75)).not.toBe('1h15m');
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
    expect(formatDuration(total)).toBe('4h 7m');
  });
});
