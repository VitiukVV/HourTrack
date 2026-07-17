import { beforeEach, describe, expect, it } from 'vitest';

import { currentPeriod, shiftPeriod, usePaymentsStore } from './paymentsStore';

describe('paymentsStore helpers', () => {
  it('currentPeriod formats a local date as YYYY-MM', () => {
    expect(currentPeriod(new Date(2026, 6, 16))).toBe('2026-07');
    expect(currentPeriod(new Date(2026, 0, 1))).toBe('2026-01');
    expect(currentPeriod(new Date(2026, 11, 31))).toBe('2026-12');
  });

  it('shiftPeriod steps months and rolls years correctly', () => {
    expect(shiftPeriod('2026-07', -1)).toBe('2026-06');
    expect(shiftPeriod('2026-07', 1)).toBe('2026-08');
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
  });
});

describe('paymentsStore', () => {
  beforeEach(() => {
    usePaymentsStore.getState().reset();
  });

  it('stepMonth moves the selected period', () => {
    usePaymentsStore.getState().setPeriod('2026-07');
    usePaymentsStore.getState().stepMonth(-1);
    expect(usePaymentsStore.getState().period).toBe('2026-06');
    usePaymentsStore.getState().stepMonth(2);
    expect(usePaymentsStore.getState().period).toBe('2026-08');
  });

  it('setPeriod sets an explicit period', () => {
    usePaymentsStore.getState().setPeriod('2025-03');
    expect(usePaymentsStore.getState().period).toBe('2025-03');
  });
});
