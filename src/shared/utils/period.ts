/**
 * Local-calendar `YYYY-MM` periods — shared by Payments and Purchases (spec 015)
 * and by the shopping repo, which stamps the month an item was added/bought.
 */

/** Current month as `YYYY-MM` from a LOCAL date (never toISOString). */
export function currentPeriod(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Shift a `'YYYY-MM'` period by `delta` months, staying in local-calendar terms. */
export function shiftPeriod(period: string, delta: number): string {
  // A garbage period would otherwise propagate as "NaN-NaN" and persist.
  if (!isPeriodString(period)) return currentPeriod();
  const [yStr, mStr] = period.split('-');
  const year = Number(yStr);
  const monthIndex = Number(mStr) - 1;
  const d = new Date(year, monthIndex + delta, 1);
  return currentPeriod(d);
}

/**
 * `true` for a canonical `YYYY-MM` with a real month number.
 *
 * The period is persisted to sessionStorage, and `PaymentsHeader` renders it
 * with `format(parseISO(`${period}-01`), 'LLLL yyyy')`. A corrupted value
 * ("undefined", "2026-13") produces an Invalid Date, `format` throws, and the
 * whole Payments page falls to the error screen. `shiftPeriod` guards with it
 * too, which covers the Purchases page's month stepper (spec 015).
 */
export function isPeriodString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}
