import { describe, expect, it } from 'vitest';

import { DATE_FORMAT, WEEK_STARTS_ON, formatDate } from './date';

describe('date constants', () => {
  it('DATE_FORMAT is "dd.MM.yyyy" per spec', () => {
    expect(DATE_FORMAT).toBe('dd.MM.yyyy');
  });

  it('WEEK_STARTS_ON is 1 (Monday)', () => {
    expect(WEEK_STARTS_ON).toBe(1);
  });
});

describe('formatDate', () => {
  it('formats a Date into DD.MM.YYYY', () => {
    const d = new Date(2026, 4, 14); // 14 May 2026
    expect(formatDate(d)).toBe('14.05.2026');
  });

  it('accepts an ISO date string and formats it the same way', () => {
    expect(formatDate('2026-01-09')).toBe('09.01.2026');
  });

  it('zero-pads single-digit day and month', () => {
    const d = new Date(2026, 0, 3); // 3 Jan 2026
    expect(formatDate(d)).toBe('03.01.2026');
  });
});
