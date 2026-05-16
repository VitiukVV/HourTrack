import type { Card, Entry } from '@hourtrack/shared-types';

/**
 * Compute EUR earnings for a single entry.
 *
 * Four branches, in precedence order (per PROJECT_PLAN.md §7.2 + S21):
 *
 *   1. CUSTOM PAYMENT WINS. If `entry.useCustomPayment` is true, return
 *      `entry.customPayment ?? 0` -- no rate math, no proportional split,
 *      even for fixed-rate OR monthly-rate cards. This is the "one-off
 *      override" path for monthly cards too: a monthly-rate card whose
 *      entry has `useCustomPayment=true` still surfaces the custom amount
 *      in `byEntry` Sum, and that amount is counted toward Reports total on
 *      TOP of the period's retainer (the retainer is its own line in
 *      `monthlyEarningsForPeriod` — they don't cancel each other out).
 *
 *   2. MONTHLY (S21). Per-entry earnings on a monthly card are zero. The
 *      retainer is billed once per calendar month at PERIOD scope, NOT per
 *      entry — see `monthlyEarningsForPeriod`. Caller composes the two:
 *      sum of per-entry custom-payment overrides + sum of monthly retainers
 *      across the period's selected monthly cards = total earnings.
 *
 *   3. HOURLY. Multiply hours (`durationMin / 60`) by `card.hourlyRate`.
 *      A null `hourlyRate` yields 0 (caller is responsible for enforcing
 *      that hourly cards persist a non-null rate).
 *
 *   4. FIXED. Distribute the card's `fixedTotal` proportionally by
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
  // 1. Custom payment always wins, regardless of rateType (including monthly).
  if (entry.useCustomPayment) {
    return entry.customPayment ?? 0;
  }

  // 2. Monthly retainer (S21): per-entry earnings are zero. The retainer is
  //    aggregated at period scope via `monthlyEarningsForPeriod` below.
  //    Placed BEFORE the hourly branch so a monthly card never accidentally
  //    flows through the hourly math when monthlyTotal is set but
  //    hourlyRate happens to also be set on a malformed row.
  if (card.rateType === 'monthly') {
    return 0;
  }

  // 3. Hourly card: hours * hourlyRate.
  if (card.rateType === 'hourly') {
    const hours = entry.durationMin / 60;
    return hours * (card.hourlyRate ?? 0);
  }

  // 4. Fixed-rate card: split the remaining pool proportionally to durationMin
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

/**
 * S21 — Compute EUR earnings contributed by a single monthly-rate card across
 * a billing period.
 *
 * Returns `0` when:
 *   - `card.rateType !== 'monthly'`
 *   - `card.monthlyTotal` is null (mis-configured monthly card)
 *   - `entries` contains no rows for this card overlapping the period
 *
 * Otherwise: count the number of distinct `YYYY-MM` month slots in
 * `[periodStart, periodEnd]` that contain ≥1 entry for this card, then
 * multiply by `card.monthlyTotal`.
 *
 * LOCKED DECISION (per user 2026-05-16): no proration. A custom range
 * `15.04 → 20.05` with entries in both Apr and May returns
 * `monthlyTotal × 2`, NOT a 1.5-month proration. Semantically "I worked on
 * this project in N billable months, charge me N retainers — regardless of
 * how many calendar days the range covered."
 *
 * Caller pre-filters `entries` to ONE card (or passes the full set; we
 * filter defensively by `cardId` inside). Both work; keeping the function
 * pure makes it ergonomic for both Reports aggregation and a future quick-
 * earnings preview.
 *
 * Date arithmetic: relies on the lexicographic order of `YYYY-MM-DD` strings
 * matching chronological order (true for all valid ISO dates), so we extract
 * the `YYYY-MM` prefix from each entry's `date` and check inclusion in
 * `[periodStart.slice(0,7), periodEnd.slice(0,7)]` via string compare. This
 * matches the rest of the codebase, which works in YYYY-MM-DD throughout.
 */
export function monthlyEarningsForPeriod(
  card: Card,
  entries: Entry[],
  periodStart: string,
  periodEnd: string,
): number {
  if (card.rateType !== 'monthly') return 0;
  if (card.monthlyTotal == null) return 0;

  // Defensive: swap if caller passed end < start. `rangeForReports` already
  // does this for custom-range inputs, but we keep the guard so the helper
  // is safe to call independently (e.g. in a unit test or quick preview).
  const start = periodStart <= periodEnd ? periodStart : periodEnd;
  const end = periodStart <= periodEnd ? periodEnd : periodStart;
  const startMonth = start.slice(0, 7); // 'YYYY-MM'
  const endMonth = end.slice(0, 7);

  const monthsWithEntries = new Set<string>();
  for (const entry of entries) {
    if (entry.cardId !== card.id) continue;
    if (entry.date < start || entry.date > end) continue;
    const month = entry.date.slice(0, 7);
    if (month < startMonth || month > endMonth) continue;
    monthsWithEntries.add(month);
  }

  return monthsWithEntries.size * card.monthlyTotal;
}
