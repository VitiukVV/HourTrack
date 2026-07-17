/**
 * Payment -- one recorded receipt of money for a card's work in a billing
 * period. Introduced in S27 alongside Dexie v7 / DriveSnapshot v4.
 *
 * A payment is the "received" side of the ledger; the "expected" side is
 * derived at read time from the earnings model (`monthlyEarningsForPeriod` +
 * `earningsForEntry` in @hourtrack/shared-utils) and is NEVER stored. Status
 * (paid / partial / unpaid / overdue) is likewise derived, never persisted.
 *
 * Design decisions (S27 spec §Locked design decisions):
 *   - `period` (the month being paid FOR) is explicit and INDEPENDENT of
 *     `paidOn` (the day cash changed hands). Cash for July handed over on
 *     August 4 is `{ period: '2026-07', paidOn: '2026-08-04' }`. The Payments
 *     page always filters by `period`.
 *   - Multiple payments per card+period are the partial-payment mechanism:
 *     `received = sum(payments for card+period)`.
 *   - Always EUR, always cash — no payment-method or currency fields.
 */
export interface Payment {
  /** uuid v4 generated client-side. */
  id: string;
  /** The card this payment is against. References `Card.id`. */
  cardId: string;
  /**
   * The month being paid FOR, as `YYYY-MM` (e.g. `'2026-07'`). This is the
   * ledger key — the Payments page filters by this, NOT by `paidOn`. Derived
   * from `Entry.date.slice(0, 7)` conventions; produced from a local date,
   * never from `toISOString` slices (timezone trap — see `Entry.date`).
   */
  period: string;
  /** EUR amount received. Always > 0 (partial payments are smaller rows, not
   *  negative adjustments). */
  amount: number;
  /**
   * Local calendar date the money changed hands, as `YYYY-MM-DD`. Produced by
   * `formatLocalDate(date)` -- NEVER by `toISOString().slice(0,10)` (timezone
   * trap). Independent of `period` by design.
   */
  paidOn: string;
  /** Optional free-text note (e.g. "готівка", "переказ за 2 місяці"). */
  note: string | null;
  /** ISO timestamp at creation. */
  createdAt: string;
  /** ISO timestamp of the most recent write. Drives Drive LWW merge. */
  updatedAt: string;
}
