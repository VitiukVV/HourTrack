// @hourtrack/shared-utils -- pure utilities consumed by apps/web and (later)
// other apps. No DOM, no IndexedDB, no Google deps -- this package must stay
// runnable in a plain Node context so we can run isolated Vitest suites.
//
// See `docs/PROJECT_PLAN.md` §7.2-§7.3 for the canonical spec.

export { formatDuration, parseDuration } from './duration';
export { earningsForEntry, monthlyEarningsForPeriod, monthlyEarningsPerEntry } from './earnings';
export {
  startOfWeekMonday,
  endOfWeekSunday,
  startOfMonth,
  endOfMonth,
  eachDayInRange,
  formatLocalDate,
} from './date-range';
