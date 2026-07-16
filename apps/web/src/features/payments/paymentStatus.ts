/**
 * Derived payment status — S27.
 *
 * Status is NEVER stored (locked design decision #1). It is a pure function of
 * the `expected` amount (from the earnings model) and the `received` amount
 * (sum of the period's payment records). `overdue` is likewise a presentation
 * modifier derived from (status, period, today) at render time — not a fourth
 * status value and never persisted.
 */

export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

/**
 * Derive the payment status for one card+period ledger row.
 *
 *   - `paid`    — `received >= expected` (overpayment collapses to paid; the
 *                 row still surfaces the real numbers). This also covers the
 *                 orphan-payment case (expected 0, received > 0).
 *   - `unpaid`  — nothing received yet (`received <= 0`).
 *   - `partial` — `0 < received < expected`.
 *
 * The `paid` check is evaluated first so an overpayment or an
 * expected-0 orphan row reads as paid rather than falling through to partial.
 */
export function paymentStatus(expected: number, received: number): PaymentStatus {
  if (received >= expected) return 'paid';
  if (received <= 0) return 'unpaid';
  return 'partial';
}

/**
 * A ledger row is OVERDUE when it is not fully paid AND its `period`
 * (`'YYYY-MM'`) is strictly before the current month. Cash for the current
 * month is not late yet; only fully-past months that still owe money are
 * overdue. Pure — `today` is injected so the check is deterministic in tests
 * and render.
 *
 * Relies on the lexicographic order of `YYYY-MM` matching chronological order
 * (true for all valid ISO year-months).
 */
export function isOverdue(
  period: string,
  status: PaymentStatus,
  today: Date = new Date(),
): boolean {
  if (status === 'paid') return false;
  const currentMonth = formatMonth(today);
  return period < currentMonth;
}

/** `YYYY-MM` for a local date. Never uses `toISOString` (timezone trap). */
function formatMonth(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
