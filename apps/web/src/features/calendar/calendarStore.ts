import { addMonths, addWeeks, format, parseISO } from 'date-fns';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CalendarView } from '@hourtrack/shared-types';

/**
 * sessionStorage key for the persisted view-mode + anchor-date slice. Exported
 * so tests and the Settings sync hook can introspect/clear it without
 * re-hardcoding the literal.
 */
export const CALENDAR_VIEW_STORAGE_KEY = 'hourtrack:calendar-view' as const;

/**
 * Drives the calendar surface (HomePage). Holds:
 *   - `mode`         — which layout is rendered (`month` | `week`).
 *   - `anchorDate`   — a local YYYY-MM-DD string identifying the date that
 *                      anchors the visible range. Month view uses this to pick
 *                      the [startOfMonth, endOfMonth] (and then the Mon→Sun
 *                      grid that surrounds it); week view uses
 *                      [startOfWeekMonday, endOfWeekSunday] containing this
 *                      date.
 *
 * Persistence is intentionally `sessionStorage`, matching the
 * `useActiveCardStore` pattern from S03: opening a new browser tab starts
 * with the default view, but in-tab navigation (`/` → `/reports` → back)
 * preserves the user's last position. The default `mode` can later be
 * overridden by `Settings.defaultView` (sync hook lands as a follow-up
 * companion in this sprint).
 *
 * Date math:
 *   - In MONTH mode, `prev`/`next` shift the anchor by ±1 month.
 *   - In WEEK mode, `prev`/`next` shift the anchor by ±7 days (one week).
 *   - `goToday` resets the anchor to today (the system date), regardless of mode.
 *
 * `anchorDate` is always a local YYYY-MM-DD via `format(date, 'yyyy-MM-dd')` —
 * the same shape as `Entry.date`. Timezones never cross this boundary.
 */
export interface CalendarViewState {
  mode: CalendarView;
  anchorDate: string;
  setMode: (mode: CalendarView) => void;
  setAnchor: (date: Date | string) => void;
  prev: () => void;
  next: () => void;
  goToday: () => void;
}

function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function toIso(date: Date | string): string {
  return format(new Date(date), 'yyyy-MM-dd');
}

export const useCalendarView = create<CalendarViewState>()(
  persist(
    (set, get) => ({
      mode: 'month',
      anchorDate: todayIso(),
      setMode: (mode) => set({ mode }),
      setAnchor: (date) => set({ anchorDate: toIso(date) }),
      prev: () => {
        const { mode, anchorDate } = get();
        const base = parseISO(anchorDate);
        const shifted = mode === 'month' ? addMonths(base, -1) : addWeeks(base, -1);
        set({ anchorDate: toIso(shifted) });
      },
      next: () => {
        const { mode, anchorDate } = get();
        const base = parseISO(anchorDate);
        const shifted = mode === 'month' ? addMonths(base, 1) : addWeeks(base, 1);
        set({ anchorDate: toIso(shifted) });
      },
      goToday: () => set({ anchorDate: todayIso() }),
    }),
    {
      name: CALENDAR_VIEW_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      // Only persist the data fields; actions are derived from the store factory.
      partialize: (state) => ({ mode: state.mode, anchorDate: state.anchorDate }),
    },
  ),
);
