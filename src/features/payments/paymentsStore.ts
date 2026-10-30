import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { currentPeriod, isPeriodString, shiftPeriod } from '@/shared/utils';

/**
 * Payments page state — the selected billing period (`'YYYY-MM'`).
 *
 * Persisted to sessionStorage (same convention as `reportsStore`) so
 * navigating away and back to /payments preserves the month within a browsing
 * session; a fresh session defaults to the current month (users almost always
 * want "this month" on open).
 */

// Re-exported for existing importers; the helpers live in shared/utils/period.
export { currentPeriod, isPeriodString, shiftPeriod };

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
