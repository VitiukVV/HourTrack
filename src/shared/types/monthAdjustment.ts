/**
 * MonthAdjustment -- the amount the user expects from one card for one month,
 * set by hand on the Payments page when it differs from the card rate (spec
 * 011: a monthly client who pays €200 instead of €250 for a month with a
 * vacation). Introduced alongside Dexie v10 / DriveSnapshot v7.
 *
 * It replaces the CALCULATED expected amount for that card+month in the
 * Payments ledger and in Reports; it never touches the card's rate or any
 * other month. Removing it ("reset to calculated") deletes the row with a
 * `monthAdjustment` tombstone.
 */
export interface MonthAdjustment {
  /** Always `monthAdjustmentId(cardId, period)` (@/shared/utils) -- at most one per card+month. */
  id: string;
  /** References `Card.id`. */
  cardId: string;
  /** The month adjusted, as `YYYY-MM`. */
  period: string;
  /** EUR expected for the month. `>= 0`; 0 means nothing is due. */
  amount: number;
  /** ISO timestamp at creation. */
  createdAt: string;
  /** ISO timestamp of the most recent write. Drives Drive LWW merge. */
  updatedAt: string;
}
