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
 * - `monthly` -- a flat retainer (`monthlyTotal` EUR) is billed once per
 *                calendar month that contains ≥1 entry of this card. Per-entry
 *                earnings on a monthly card are zero (the retainer is
 *                aggregated at PERIOD scope via `monthlyEarningsForPeriod` in
 *                @hourtrack/shared-utils). Custom-payment entries still win
 *                their `customPayment` amount and are counted as one-off line
 *                items on top of the retainer. Introduced in S21.
 */
export type RateType = 'hourly' | 'fixed' | 'monthly';

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
  /**
   * Default start time of day, expressed as minutes since local midnight.
   * Range: 0 (00:00) through 1439 (23:59) inclusive. e.g. 600 = 10:00.
   * Copied into `Entry.startMinutes` on the active-card calendar click flow;
   * individual entries can override it via the entry editor (#8 in
   * V2_FEATURE_PLAN). Required since v2 of the on-disk format — see
   * DriveSnapshot.schemaVersion.
   */
  defaultStartMinutes: number;
  rateType: RateType;
  /** EUR per hour. Required when `rateType === 'hourly'`, otherwise null. */
  hourlyRate: number | null;
  /** EUR total budget. Required when `rateType === 'fixed'`, otherwise null. */
  fixedTotal: number | null;
  /**
   * EUR per month, applied as a flat retainer for every month in which the
   * card has ≥1 entry. Required (non-null, positive) when
   * `rateType === 'monthly'`, otherwise null. Introduced in S21 alongside
   * Dexie v6 / DriveSnapshot v3.
   */
  monthlyTotal: number | null;
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
