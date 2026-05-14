import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { formatLocalDate } from '@hourtrack/shared-utils';

/**
 * Reports filter state. Persisted to sessionStorage (per S03 convention) so
 * navigating away and back to /reports preserves the user's filter setup
 * within the same browsing session. Cross-session persistence is intentionally
 * skipped — users typically want "current month" as the fresh default.
 *
 * `selectedCardIds`:
 *   - `null`  — sentinel for "follow the active-cards list". The hook expands
 *               this into the live set of active (+ archived if `showArchived`)
 *               card IDs at query-time so the filter doesn't go stale when the
 *               user creates a new card mid-session.
 *   - `[]`    — explicit empty selection ("hide everything"). Reports renders
 *               an empty state.
 *   - `[..]`  — explicit list of card IDs the user opted into.
 */

export type ReportsPeriod = 'day' | 'week' | 'month' | 'custom';

interface ReportsFiltersState {
  period: ReportsPeriod;
  /** YYYY-MM-DD; anchor for day/week/month. Ignored for custom. */
  anchorDate: string;
  /** YYYY-MM-DD; only meaningful when period === 'custom'. */
  customStart: string | null;
  customEnd: string | null;
  /**
   * `null` means "all active (+ archived if showArchived) cards". An explicit
   * array overrides that and pins the selection.
   */
  selectedCardIds: string[] | null;
  showArchived: boolean;

  setPeriod: (period: ReportsPeriod) => void;
  setAnchorDate: (date: string) => void;
  setCustomRange: (start: string, end: string) => void;
  /**
   * Toggle one card on or off. Caller passes the current available card-ID
   * list so we can convert the `null` sentinel into an explicit array on the
   * first toggle. Without this argument we'd have no way to "remove" one card
   * from "all".
   */
  toggleCardId: (cardId: string, availableCardIds: string[]) => void;
  selectAll: () => void;
  clearAll: () => void;
  setShowArchived: (show: boolean) => void;
  reset: () => void;
}

function defaultState(): Omit<
  ReportsFiltersState,
  | 'setPeriod'
  | 'setAnchorDate'
  | 'setCustomRange'
  | 'toggleCardId'
  | 'selectAll'
  | 'clearAll'
  | 'setShowArchived'
  | 'reset'
> {
  return {
    period: 'month',
    anchorDate: formatLocalDate(new Date()),
    customStart: null,
    customEnd: null,
    selectedCardIds: null,
    showArchived: false,
  };
}

export const useReportsFilters = create<ReportsFiltersState>()(
  persist(
    (set, get) => ({
      ...defaultState(),

      setPeriod: (period) => set({ period }),
      setAnchorDate: (anchorDate) => set({ anchorDate }),
      setCustomRange: (customStart, customEnd) => set({ customStart, customEnd, period: 'custom' }),

      toggleCardId: (cardId, availableCardIds) => {
        const current = get().selectedCardIds;
        const baseline = current ?? availableCardIds;
        const hasIt = baseline.includes(cardId);
        const next = hasIt ? baseline.filter((id) => id !== cardId) : [...baseline, cardId];
        set({ selectedCardIds: next });
      },

      selectAll: () => set({ selectedCardIds: null }),
      clearAll: () => set({ selectedCardIds: [] }),
      setShowArchived: (showArchived) => set({ showArchived }),

      reset: () => set(defaultState()),
    }),
    {
      name: 'hourtrack:reports-filters',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        period: state.period,
        anchorDate: state.anchorDate,
        customStart: state.customStart,
        customEnd: state.customEnd,
        selectedCardIds: state.selectedCardIds,
        showArchived: state.showArchived,
      }),
    },
  ),
);
