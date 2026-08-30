import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { formatLocalDate, startOfMonth, startOfWeekMonday } from '@hourtrack/shared-utils';

import { isIsoDateString } from '@/lib/date';

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
  /**
   * S20 (Task 12) — drop any explicit card narrowing and return to the
   * "follow active cards" sentinel. Distinct from `selectAll` only in intent:
   * both end at `selectedCardIds = null`. Kept as a separate action so the
   * Reports "Reset cards" button has a self-documenting handler name and so
   * tests can assert the right verb fired.
   */
  clearCardSelection: () => void;
  setShowArchived: (show: boolean) => void;
  reset: () => void;
}

/**
 * S20 (Task 1 / Task 10): the period→anchor snap rules.
 *
 *   - month: anchor = startOfMonth(today)
 *   - week:  anchor = Monday of the current week
 *   - day:   anchor = today (locked decision — keeps UX consistent;
 *            switching to `day` from any other period should always land on
 *            today, not on an arbitrary stale anchor)
 *   - custom: anchor is irrelevant; we leave the prior anchor value alone
 *            so toggling back to a non-custom period doesn't lose context.
 */
function anchorForPeriod(period: ReportsPeriod, prev: string): string {
  const today = new Date();
  if (period === 'month') return formatLocalDate(startOfMonth(today));
  if (period === 'week') return formatLocalDate(startOfWeekMonday(today));
  if (period === 'day') return formatLocalDate(today);
  return prev;
}

function defaultState(): Omit<
  ReportsFiltersState,
  | 'setPeriod'
  | 'setAnchorDate'
  | 'setCustomRange'
  | 'toggleCardId'
  | 'selectAll'
  | 'clearAll'
  | 'clearCardSelection'
  | 'setShowArchived'
  | 'reset'
> {
  // S20 (Task 10): defaults snap anchor to the first day of the current
  // month — matches the period default (`'month'`) and matches the post-
  // reset state expected by the user.
  return {
    period: 'month',
    anchorDate: formatLocalDate(startOfMonth(new Date())),
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

      // S20 (Task 1): switching period also re-anchors. Previously the anchor
      // kept whatever date the user last picked, which produced
      // "Month selected but the input shows today" — a confusing UX. Now the
      // input always shows the period's own start point.
      setPeriod: (period) => {
        const prev = get().anchorDate;
        set({ period, anchorDate: anchorForPeriod(period, prev) });
      },
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
      // S20 (Task 12): semantically equivalent to selectAll, distinct name
      // for "the user clicked Reset cards on the chip row".
      clearCardSelection: () => set({ selectedCardIds: null }),
      setShowArchived: (showArchived) => set({ showArchived }),

      reset: () => set(defaultState()),
    }),
    {
      name: 'hourtrack:reports-filters',
      storage: createJSONStorage(() => sessionStorage),
      // Sanitize the rehydrated slice, the same hardening `calendarStore`
      // got in S29. A corrupted / hand-edited sessionStorage value (an
      // `anchorDate` of "undefined", a non-calendar date like 2026-13-40, a
      // `selectedCardIds` that is not an array) otherwise flows straight into
      // `parseISO` → Invalid Date → `format` throws, and /reports renders the
      // crash screen instead of a report.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ReportsFiltersState>;
        const period: ReportsPeriod =
          p.period === 'day' || p.period === 'week' || p.period === 'month' || p.period === 'custom'
            ? p.period
            : current.period;
        return {
          ...current,
          period,
          anchorDate: isIsoDateString(p.anchorDate) ? p.anchorDate : current.anchorDate,
          customStart: isIsoDateString(p.customStart) ? p.customStart : null,
          customEnd: isIsoDateString(p.customEnd) ? p.customEnd : null,
          selectedCardIds:
            p.selectedCardIds === null || p.selectedCardIds === undefined
              ? null
              : Array.isArray(p.selectedCardIds) &&
                  p.selectedCardIds.every((id) => typeof id === 'string')
                ? p.selectedCardIds
                : null,
          showArchived: typeof p.showArchived === 'boolean' ? p.showArchived : false,
        };
      },
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
