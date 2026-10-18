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
  // A garbage period would otherwise propagate as "NaN-NaN" and persist.
  if (!isPeriodString(period)) return currentPeriod();
  const [yStr, mStr] = period.split('-');
  const year = Number(yStr);
  const monthIndex = Number(mStr) - 1;
  const d = new Date(year, monthIndex + delta, 1);
  return currentPeriod(d);
}

/**
 * `true` for a canonical `YYYY-MM` with a real month number.
 *
 * The period is persisted to sessionStorage, and `PaymentsHeader` renders it
 * with `format(parseISO(`${period}-01`), 'LLLL yyyy')`. A corrupted value
 * ("undefined", "2026-13") produces an Invalid Date, `format` throws, and the
 * whole Payments page falls to the error screen.
 */
export function isPeriodString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
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
      setPeriod: (period) => set({ period: isPeriodString(period) ? period : currentPeriod() }),
      stepMonth: (delta) => set({ period: shiftPeriod(get().period, delta) }),
      reset: () => set({ period: currentPeriod() }),
    }),
    {
      name: 'hourtrack:payments',
      storage: createJSONStorage(() => sessionStorage),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PaymentsState>;
        return {
          ...current,
          period: isPeriodString(p.period) ? p.period : currentPeriod(),
        };
      },
      partialize: (state) => ({ period: state.period }),
    },
  ),
);
