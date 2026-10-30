// @/shared/utils -- pure domain utilities. No DOM, no IndexedDB, no Google
// deps -- this module must stay runnable in a plain Node context.
//
// See `docs/PROJECT_PLAN.md` §7.2-§7.3 for the canonical spec.

export { formatDuration, parseDuration } from './duration';
export { compareEntriesForDisplay } from './entry-order';
export { MONTH_ADJUSTMENT_MAX, MONTH_PERIOD_RE, monthAdjustmentId } from './month-adjustment';
export { SHOPPING_TEXT_MAX, normalizeShoppingText, shoppingItemsForMonth } from './shopping';
export type { ShoppingMonth } from './shopping';
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
export { currentPeriod, isPeriodString, shiftPeriod } from './period';
