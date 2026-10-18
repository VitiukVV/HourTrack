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
 * Half a cent, in EUR. The comparison tolerance for payment classification.
 *
 * S31 (UR-31-1): `expected` is computed unrounded from the earnings model
 * (`(durationMin / 60) * hourlyRate`), e.g. `(50/60)*40 = 33.33333…`, while the
 * Mark-paid dialog pre-fills the DISPLAYED remaining amount
 * (`Number(remaining.toFixed(2))`, e.g. `33.33`). Paying exactly what the UI
 * showed therefore leaves a sub-cent float residue against `expected`, and a
 * raw `>=` compare would keep a fully-paid card stuck `partial`/`overdue`
 * forever. Half a cent is below the smallest amount the user can pay (1 cent),
 * so it can never mask a genuine 1-cent shortfall.
 */
const EPS = 0.005;

/**
 * Derive the payment status for one card+period ledger row.
 *
 *   - `paid`    — `received >= expected - EPS` (overpayment collapses to paid;
 *                 the row still surfaces the real numbers). This also covers the
 *                 orphan-payment case (expected 0, received > 0). The EPS
 *                 tolerance absorbs the sub-cent float residue from paying the
 *                 rounded displayed amount against an unrounded `expected`.
 *   - `unpaid`  — nothing meaningful received yet (`received <= EPS`, so a
 *                 dust-only float never counts as a partial payment).
 *   - `partial` — `EPS < received < expected - EPS`.
 *
 * The `paid` check is evaluated first so an overpayment or an
 * expected-0 orphan row reads as paid rather than falling through to partial.
 */
export function paymentStatus(expected: number, received: number): PaymentStatus {
  if (received >= expected - EPS) return 'paid';
  if (received <= EPS) return 'unpaid';
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
