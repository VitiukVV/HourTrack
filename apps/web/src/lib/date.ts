import { format } from 'date-fns';

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

/** Format a Date or ISO string as `DD.MM.YYYY` for UI display. */
export function formatDate(date: Date | string): string {
  return format(new Date(date), DATE_FORMAT);
}
