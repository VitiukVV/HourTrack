import { describe, expect, it } from 'vitest';

import {
  nextRetryDelay,
  retrySchedule,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
} from './retryPolicy';

describe('retryPolicy', () => {
  it('produces the canonical doubling schedule 2/4/8/16/32 then caps at 60', () => {
    expect(retrySchedule(7)).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  });

  it('clamps to the cap for any large attempt count', () => {
    expect(nextRetryDelay(20)).toBe(RETRY_MAX_DELAY_MS);
    expect(nextRetryDelay(100)).toBe(RETRY_MAX_DELAY_MS);
  });

  it('returns the base delay for negative or non-finite inputs', () => {
    expect(nextRetryDelay(-1)).toBe(RETRY_BASE_DELAY_MS);
    expect(nextRetryDelay(Number.NaN)).toBe(RETRY_BASE_DELAY_MS);
    expect(nextRetryDelay(Number.POSITIVE_INFINITY)).toBe(RETRY_BASE_DELAY_MS);
  });

  it('exposes the base delay constant for direct consumers', () => {
    expect(RETRY_BASE_DELAY_MS).toBe(2_000);
    expect(RETRY_MAX_DELAY_MS).toBe(60_000);
  });
});
