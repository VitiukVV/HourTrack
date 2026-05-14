import type { Card, Entry } from '@hourtrack/shared-types';

/**
 * Compute EUR earnings for a single entry.
 *
 * Three branches, in precedence order (per PROJECT_PLAN.md §7.2):
 *
 *   1. CUSTOM PAYMENT WINS. If `entry.useCustomPayment` is true, return
 *      `entry.customPayment ?? 0` -- no rate math, no proportional split,
 *      even for fixed-rate cards.
 *
 *   2. HOURLY. Multiply hours (`durationMin / 60`) by `card.hourlyRate`.
 *      A null `hourlyRate` yields 0 (caller is responsible for enforcing
 *      that hourly cards persist a non-null rate).
 *
 *   3. FIXED. Distribute the card's `fixedTotal` proportionally by
 *      `durationMin` across all NON-custom-payment entries for the same
 *      card. The pool shrinks by any custom-payment entries' amounts:
 *
 *          remainingPool   = max(0, fixedTotal - sum(customPayments))
 *          nonCustomMinutes = sum(durationMin) over !useCustomPayment
 *          earnings        = (entry.durationMin / nonCustomMinutes) * remainingPool
 *
 *      Returns 0 if `nonCustomMinutes` is 0 or the remaining pool is 0.
 *      Caller passes ALL entries for the card (`allCardEntries`) so the
 *      split is computed against the full card scope.
 *
 * Rounding: this function returns a raw floating-point EUR amount. Callers
 * that need 2-decimal display precision must round at the presentation
 * boundary (e.g. via `(value).toFixed(2)`) -- NEVER round inside this
 * function, because per-entry rounding errors compound across reports.
 */
export function earningsForEntry(entry: Entry, card: Card, allCardEntries: Entry[]): number {
  // 1. Custom payment always wins, regardless of rateType.
  if (entry.useCustomPayment) {
    return entry.customPayment ?? 0;
  }

  // 2. Hourly card: hours * hourlyRate.
  if (card.rateType === 'hourly') {
    const hours = entry.durationMin / 60;
    return hours * (card.hourlyRate ?? 0);
  }

  // 3. Fixed-rate card: split the remaining pool proportionally to durationMin
  //    across non-custom entries.
  const total = card.fixedTotal ?? 0;

  const customSum = allCardEntries
    .filter((e) => e.useCustomPayment)
    .reduce((sum, e) => sum + (e.customPayment ?? 0), 0);

  const remaining = Math.max(0, total - customSum);

  const nonCustomMinutes = allCardEntries
    .filter((e) => !e.useCustomPayment)
    .reduce((sum, e) => sum + e.durationMin, 0);

  if (nonCustomMinutes === 0) return 0;

  return (entry.durationMin / nonCustomMinutes) * remaining;
}
