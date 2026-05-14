import { describe, expect, it } from 'vitest';

import {
  startOfWeekMonday,
  endOfWeekSunday,
  startOfMonth as startOfMonthFn,
  endOfMonth as endOfMonthFn,
  eachDayInRange,
  formatLocalDate,
} from './date-range';

describe('startOfWeekMonday', () => {
  it('returns the same day when given a Monday', () => {
    // 2026-05-11 is a Monday
    const monday = new Date(2026, 4, 11);
    const result = startOfWeekMonday(monday);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(4);
    expect(result.getDate()).toBe(11);
  });

  it('returns previous Monday when given a Sunday', () => {
    // 2026-05-17 is a Sunday -> previous Monday is 2026-05-11
    const sunday = new Date(2026, 4, 17);
    const result = startOfWeekMonday(sunday);
    expect(result.getDate()).toBe(11);
    expect(result.getMonth()).toBe(4);
  });

  it('returns Monday of the week when given a Thursday', () => {
    // 2026-05-14 is a Thursday -> Monday is 2026-05-11
    const thursday = new Date(2026, 4, 14);
    const result = startOfWeekMonday(thursday);
    expect(result.getDate()).toBe(11);
  });
});

describe('endOfWeekSunday', () => {
  it('returns the same day when given a Sunday', () => {
    const sunday = new Date(2026, 4, 17);
    const result = endOfWeekSunday(sunday);
    expect(result.getDate()).toBe(17);
  });

  it('returns following Sunday when given a Monday', () => {
    const monday = new Date(2026, 4, 11);
    const result = endOfWeekSunday(monday);
    expect(result.getDate()).toBe(17);
  });
});

describe('startOfMonth / endOfMonth', () => {
  it('startOfMonth returns the 1st', () => {
    const d = new Date(2026, 4, 14);
    expect(startOfMonthFn(d).getDate()).toBe(1);
    expect(startOfMonthFn(d).getMonth()).toBe(4);
  });

  it('endOfMonth returns the last day (May = 31)', () => {
    const d = new Date(2026, 4, 14);
    expect(endOfMonthFn(d).getDate()).toBe(31);
    expect(endOfMonthFn(d).getMonth()).toBe(4);
  });

  it('endOfMonth returns 28 for February non-leap', () => {
    const d = new Date(2025, 1, 10);
    expect(endOfMonthFn(d).getDate()).toBe(28);
  });
});

describe('eachDayInRange', () => {
  it('spans Mon -> Sun inclusive for a full week', () => {
    const monday = new Date(2026, 4, 11);
    const sunday = new Date(2026, 4, 17);
    const days = eachDayInRange(monday, sunday);
    expect(days).toHaveLength(7);
    expect(days[0]?.getDate()).toBe(11);
    expect(days[6]?.getDate()).toBe(17);
  });

  it('returns single-day array when start equals end', () => {
    const d = new Date(2026, 4, 14);
    const days = eachDayInRange(d, d);
    expect(days).toHaveLength(1);
    expect(days[0]?.getDate()).toBe(14);
  });
});

describe('formatLocalDate', () => {
  it('formats Date into YYYY-MM-DD without timezone shift', () => {
    const d = new Date(2026, 4, 14);
    expect(formatLocalDate(d)).toBe('2026-05-14');
  });

  it('zero-pads month and day', () => {
    const d = new Date(2026, 0, 9);
    expect(formatLocalDate(d)).toBe('2026-01-09');
  });
});
