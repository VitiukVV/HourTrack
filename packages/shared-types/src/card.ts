/**
 * Card -- a "project" / payee in HourTrack. Cards are the parent of Entry rows
 * (one entry per logged work session on a calendar day).
 *
 * Mirrors PROJECT_PLAN.md §7.1 verbatim. Any field change here is a breaking
 * change to the on-device Dexie schema AND to the Drive `data.json` snapshot
 * format -- bump schemaVersion in DriveSnapshot if you touch this shape.
 */

/**
 * How earnings are calculated for entries belonging to this card.
 *
 * - `hourly`  -- earnings = durationMin/60 * hourlyRate
 * - `fixed`   -- a single `fixedTotal` budget is split proportionally across
 *                non-custom-payment entries by `durationMin`. See
 *                `earningsForEntry` in @hourtrack/shared-utils.
 */
export type RateType = 'hourly' | 'fixed';

export interface Card {
  /** uuid v4 generated client-side. */
  id: string;
  name: string;
  /**
   * Hex string. MUST be one of the 12 preset palette colors -- see
   * `CARD_COLORS` and `isValidCardColor` in `apps/web/src/lib/colors.ts`.
   */
  color: string;
  /**
   * Default minutes per day applied when an entry is created via the
   * active-card calendar click flow. e.g. 480 = 8h. Always stored as integer
   * minutes; never as hours.
   */
  defaultDurationMin: number;
  rateType: RateType;
  /** EUR per hour. Required when `rateType === 'hourly'`, otherwise null. */
  hourlyRate: number | null;
  /** EUR total budget. Required when `rateType === 'fixed'`, otherwise null. */
  fixedTotal: number | null;
  /** Optional default note copied into Entry.note on creation. */
  defaultNote: string | null;
  /** Soft-delete flag. Archived cards are excluded from default queries. */
  isArchived: boolean;
  /** ISO timestamp when isArchived flipped to true; null otherwise. */
  archivedAt: string | null;
  /** ISO timestamp when the card was created. */
  createdAt: string;
  /** ISO timestamp of the most recent write to this card. */
  updatedAt: string;
}
