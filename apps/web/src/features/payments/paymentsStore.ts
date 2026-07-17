import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Payments page state — the selected billing period (`'YYYY-MM'`).
 *
 * Persisted to sessionStorage (same convention as `reportsStore`) so
 * navigating away and back to /payments preserves the month within a browsing
 * session; a fresh session defaults to the current month (users almost always
 * want "this month" on open).
 */

/** Current month as `YYYY-MM` from a LOCAL date (never toISOString). */
export function currentPeriod(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Shift a `'YYYY-MM'` period by `delta` months, staying in local-calendar terms. */
export function shiftPeriod(period: string, delta: number): string {
  const [yStr, mStr] = period.split('-');
  const year = Number(yStr);
  const monthIndex = Number(mStr) - 1;
  const d = new Date(year, monthIndex + delta, 1);
  return currentPeriod(d);
}

interface PaymentsState {
  /** Selected month as `YYYY-MM`. */
  period: string;
  setPeriod: (period: string) => void;
  /** Step to the previous / next calendar month. */
  stepMonth: (delta: number) => void;
  reset: () => void;
}

export const usePaymentsStore = create<PaymentsState>()(
  persist(
    (set, get) => ({
      period: currentPeriod(),
      setPeriod: (period) => set({ period }),
      stepMonth: (delta) => set({ period: shiftPeriod(get().period, delta) }),
      reset: () => set({ period: currentPeriod() }),
    }),
    {
      name: 'hourtrack:payments',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ period: state.period }),
    },
  ),
);
