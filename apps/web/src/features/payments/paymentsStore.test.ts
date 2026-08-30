import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

describe('persisted period sanitizing', () => {
  afterEach(() => {
    sessionStorage.removeItem('hourtrack:payments');
    usePaymentsStore.getState().reset();
  });

  it('falls back to the current month for a corrupted persisted period', async () => {
    sessionStorage.setItem(
      'hourtrack:payments',
      JSON.stringify({ state: { period: 'undefined' }, version: 0 }),
    );

    await usePaymentsStore.persist.rehydrate();

    // "undefined-01" would parse to Invalid Date and crash PaymentsHeader.
    expect(usePaymentsStore.getState().period).toBe(currentPeriod());
  });

  it('keeps a valid persisted period', async () => {
    sessionStorage.setItem(
      'hourtrack:payments',
      JSON.stringify({ state: { period: '2026-03' }, version: 0 }),
    );

    await usePaymentsStore.persist.rehydrate();

    expect(usePaymentsStore.getState().period).toBe('2026-03');
  });

  it('rejects an impossible month and refuses to persist it', () => {
    usePaymentsStore.getState().setPeriod('2026-13');
    expect(usePaymentsStore.getState().period).toBe(currentPeriod());
  });

  it('shiftPeriod on a garbage period returns the current month, not NaN-NaN', () => {
    expect(shiftPeriod('not-a-period', 1)).toBe(currentPeriod());
  });
});
