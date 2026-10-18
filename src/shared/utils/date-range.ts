import {
  startOfWeek as dfStartOfWeek,
  endOfWeek as dfEndOfWeek,
  startOfMonth as dfStartOfMonth,
  endOfMonth as dfEndOfMonth,
  eachDayOfInterval,
  format,
  parseISO,
} from 'date-fns';

/**
 * Date-range helpers with `weekStartsOn: 1` (Monday) baked in.
 *
 * IMPORTANT: All callers MUST use these wrappers rather than `date-fns`
 * directly. We bake `weekStartsOn` into the helper so a stray default
 * (Sunday) cannot leak into report filters or calendar week ranges.
 */

const MONDAY = 1 as const;

/**
 * Normalize `Date | string` input to a `Date` in LOCAL time.
 *
 * Strings go through `parseISO`, NOT `new Date(string)`: the latter parses
 * date-only strings (`YYYY-MM-DD`, the canonical `Entry.date` shape) as UTC
 * midnight, which lands on the PREVIOUS calendar day for every user west of
 * UTC. `parseISO` parses date-only strings as local midnight instead.
 */
function toLocalDate(date: Date | string): Date {
  return typeof date === 'string' ? parseISO(date) : date;
}

/** First Monday on or before `date`. */
export function startOfWeekMonday(date: Date | string): Date {
  return dfStartOfWeek(toLocalDate(date), { weekStartsOn: MONDAY });
}

/** First Sunday on or after `date` (sets time to end-of-day). */
export function endOfWeekSunday(date: Date | string): Date {
  return dfEndOfWeek(toLocalDate(date), { weekStartsOn: MONDAY });
}

/** First day of the month containing `date`. */
export function startOfMonth(date: Date | string): Date {
  return dfStartOfMonth(toLocalDate(date));
}

/** Last day of the month containing `date`. */
export function endOfMonth(date: Date | string): Date {
  return dfEndOfMonth(toLocalDate(date));
}

/**
 * Inclusive day-by-day iteration. Returns one `Date` per day in the
 * `[start, end]` interval (both ends included). Use for calendar grids
 * and report buckets.
 */
export function eachDayInRange(start: Date | string, end: Date | string): Date[] {
  return eachDayOfInterval({ start: toLocalDate(start), end: toLocalDate(end) });
}

/**
 * Format a `Date` as `YYYY-MM-DD` in LOCAL time. This is the canonical
 * shape for `Entry.date`. Never use `.toISOString().slice(0,10)` -- that
 * silently shifts dates near midnight across timezones.
 */
export function formatLocalDate(date: Date | string): string {
  return format(toLocalDate(date), 'yyyy-MM-dd');
}
