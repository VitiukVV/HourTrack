import { format, parseISO } from 'date-fns';

/**
 * UI-facing date helpers for HourTrack.
 *
 * - All user-visible dates are formatted as `DD.MM.YYYY` (`dd.MM.yyyy` in
 *   date-fns tokens) regardless of locale -- PROJECT_PLAN.md §7.4 / req #5.
 * - Week starts on Monday (req #10).
 *
 * For local YYYY-MM-DD serialization (used as `Entry.date`), prefer
 * `formatLocalDate` from `@hourtrack/shared-utils`. This file is the
 * presentation-layer wrapper, not the storage-layer one.
 */

export const DATE_FORMAT = 'dd.MM.yyyy' as const;
export const WEEK_STARTS_ON = 1 as const; // Monday

/**
 * Format a Date or ISO string as `DD.MM.YYYY` for UI display.
 *
 * Strings are parsed with `parseISO`, not `new Date(string)`: the latter
 * treats date-only strings (`YYYY-MM-DD`) as UTC midnight, which renders the
 * previous calendar day for users west of UTC. `parseISO` yields local
 * midnight for date-only input.
 */
export function formatDate(date: Date | string): string {
  return format(typeof date === 'string' ? parseISO(date) : date, DATE_FORMAT);
}
