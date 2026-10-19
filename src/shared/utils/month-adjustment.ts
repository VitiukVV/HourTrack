/**
 * The deterministic id of a card+month `MonthAdjustment` (spec 011). Two
 * devices adjusting the same month write the same id, so the Drive LWW merge
 * keeps the latest edit instead of ending up with two rows for one month.
 */
export function monthAdjustmentId(cardId: string, period: string): string {
  return `${cardId}:${period}`;
}
