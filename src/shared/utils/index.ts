// @/shared/utils -- pure domain utilities. No DOM, no IndexedDB, no Google
// deps -- this module must stay runnable in a plain Node context.
//
// See `docs/PROJECT_PLAN.md` §7.2-§7.3 for the canonical spec.

export { formatDuration, parseDuration } from './duration';
export { compareEntriesForDisplay } from './entry-order';
export { monthAdjustmentId } from './month-adjustment';
export {
  adjustedEntryShares,
  calculatedMonthTotal,
  earningsForEntry,
  monthlyEarningsForPeriod,
  monthlyEarningsPerEntry,
} from './earnings';
export {
  startOfWeekMonday,
  endOfWeekSunday,
  startOfMonth,
  endOfMonth,
  eachDayInRange,
  formatLocalDate,
} from './date-range';
