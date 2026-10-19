/** A valid `YYYY-MM` month (01–12) — the `MonthAdjustment.period` rule. */
export const MONTH_PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Upper bound for a hand-set expected amount (spec 011 edge cases). The form,
 * the repo write and the Drive/backup import all enforce it.
 */
export const MONTH_ADJUSTMENT_MAX = 1_000_000;

/**
 * The deterministic id of a card+month `MonthAdjustment` (spec 011). Two
 * devices adjusting the same month write the same id, so the Drive LWW merge
 * keeps the latest edit instead of ending up with two rows for one month.
 */
export function monthAdjustmentId(cardId: string, period: string): string {
  return `${cardId}:${period}`;
}
