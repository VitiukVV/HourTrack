import {
  startOfWeek as dfStartOfWeek,
  endOfWeek as dfEndOfWeek,
  startOfMonth as dfStartOfMonth,
  endOfMonth as dfEndOfMonth,
  eachDayOfInterval,
  format,
} from 'date-fns';

/**
 * Date-range helpers with `weekStartsOn: 1` (Monday) baked in.
 *
 * IMPORTANT: All callers MUST use these wrappers rather than `date-fns`
 * directly. We bake `weekStartsOn` into the helper so a stray default
 * (Sunday) cannot leak into report filters or calendar week ranges.
 */

const MONDAY = 1 as const;

/** First Monday on or before `date`. */
export function startOfWeekMonday(date: Date | string): Date {
  return dfStartOfWeek(new Date(date), { weekStartsOn: MONDAY });
}

/** First Sunday on or after `date` (sets time to end-of-day). */
export function endOfWeekSunday(date: Date | string): Date {
  return dfEndOfWeek(new Date(date), { weekStartsOn: MONDAY });
}

/** First day of the month containing `date`. */
export function startOfMonth(date: Date | string): Date {
  return dfStartOfMonth(new Date(date));
}

/** Last day of the month containing `date`. */
export function endOfMonth(date: Date | string): Date {
  return dfEndOfMonth(new Date(date));
}

/**
 * Inclusive day-by-day iteration. Returns one `Date` per day in the
 * `[start, end]` interval (both ends included). Use for calendar grids
 * and report buckets.
 */
export function eachDayInRange(start: Date | string, end: Date | string): Date[] {
  return eachDayOfInterval({ start: new Date(start), end: new Date(end) });
}

/**
 * Format a `Date` as `YYYY-MM-DD` in LOCAL time. This is the canonical
 * shape for `Entry.date`. Never use `.toISOString().slice(0,10)` -- that
 * silently shifts dates near midnight across timezones.
 */
export function formatLocalDate(date: Date | string): string {
  return format(new Date(date), 'yyyy-MM-dd');
}
