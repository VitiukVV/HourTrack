import type { Card, Entry } from '@hourtrack/shared-types';

/**
 * Compute EUR earnings for a single entry.
 *
 * Four branches, in precedence order:
 *
 *   1. CUSTOM PAYMENT WINS. If `entry.useCustomPayment` is true, return
 *      `entry.customPayment ?? 0` -- no rate math, even for fixed-rate OR
 *      monthly-rate cards. This is the "one-off override" path for monthly
 *      cards too: a monthly-rate card whose entry has `useCustomPayment=true`
 *      still surfaces the custom amount in `byEntry` Sum, and that amount is
 *      counted toward Reports total on TOP of the period's retainer (the
 *      retainer is its own line in `monthlyEarningsForPeriod` — they don't
 *      cancel each other out).
 *
 *   2. MONTHLY. Per-entry earnings on a monthly card are zero by default; the
 *      retainer is billed once per calendar month at PERIOD scope, NOT per
 *      entry — see `monthlyEarningsForPeriod`. For Reports per-entry display
 *      use `monthlyEarningsPerEntry` which divides the month's retainer
 *      across working days and entries on each day.
 *
 *   3. HOURLY. Multiply hours (`durationMin / 60`) by `card.hourlyRate`.
 *      A null `hourlyRate` yields 0 (caller is responsible for enforcing
 *      that hourly cards persist a non-null rate).
 *
 *   4. FIXED. Per-entry flat amount: each non-custom entry on a fixed card
 *      earns the full `card.fixedTotal`. (Previously fixedTotal was a single
 *      budget split proportionally across all the card's entries; the
 *      new semantic is "fixed price per session", so logging 3 entries on a
 *      35 EUR fixed card yields 3 × 35 = 105 EUR.) Custom-payment entries
 *      still hit branch (1) and contribute their `customPayment` instead.
 *      Returns 0 when `fixedTotal` is null.
 *
 * `allCardEntries` is no longer used for the rate math (fixed is now
 * per-entry), but the parameter is kept so call sites don't have to plumb
 * different shapes per branch. It MAY still be used by future branches.
 *
 * Rounding: this function returns a raw floating-point EUR amount. Callers
 * that need 2-decimal display precision must round at the presentation
 * boundary (e.g. via `(value).toFixed(2)`) -- NEVER round inside this
 * function, because per-entry rounding errors compound across reports.
 */
export function earningsForEntry(entry: Entry, card: Card, _allCardEntries: Entry[]): number {
  // 1. Custom payment always wins, regardless of rateType (including monthly).
  if (entry.useCustomPayment) {
    return entry.customPayment ?? 0;
  }

  // 2. Monthly retainer: per-entry earnings are zero at this granularity.
  //    The retainer is aggregated at period scope via
  //    `monthlyEarningsForPeriod`; per-entry display for Reports uses
  //    `monthlyEarningsPerEntry`. Placed BEFORE the hourly branch so a
  //    monthly card never accidentally flows through the hourly math when
  //    monthlyTotal is set but hourlyRate happens to also be set on a
  //    malformed row.
  if (card.rateType === 'monthly') {
    return 0;
  }

  // 3. Hourly card: hours * hourlyRate.
  if (card.rateType === 'hourly') {
    const hours = entry.durationMin / 60;
    return hours * (card.hourlyRate ?? 0);
  }

  // 4. Fixed-rate card: flat per-entry amount.
  return card.fixedTotal ?? 0;
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

/**
 * Per-entry share of a monthly card's retainer, for the Reports `byEntry`
 * row. The retainer for the entry's calendar month is divided evenly across
 * every non-custom entry of this card in that month:
 *
 *   per_entry = monthlyTotal / count(nonCustomEntriesInSameMonthForCard)
 *
 * Example: monthlyTotal = 250, 13 non-custom entries in May → each entry
 * carries 250 / 13 ≈ 19.23 EUR. Summing across all 13 entries yields
 * exactly 250 (modulo float). When the Reports filter narrows the visible
 * set (e.g. a week showing 3 of those 13 entries), each of the 3 visible
 * rows still carries 19.23 — the denominator MUST stay 13 (i.e. the
 * month scope), so callers must pass `allCardEntries` covering the FULL
 * calendar month of the entry, not just the period-filtered subset.
 *
 * Returns 0 when:
 *   - `card.rateType !== 'monthly'`
 *   - `card.monthlyTotal` is null
 *   - the entry uses a custom payment (callers should hit `earningsForEntry`
 *     instead — the custom-payment branch wins)
 *   - there are no non-custom entries in the entry's month for this card
 *
 * Custom-payment entries on the same monthly card are intentionally NOT
 * counted toward the denominator: they pay their own amount on top of the
 * retainer (locked decision, see `earningsForEntry` docstring).
 */
export function monthlyEarningsPerEntry(entry: Entry, card: Card, allCardEntries: Entry[]): number {
  if (card.rateType !== 'monthly') return 0;
  if (card.monthlyTotal == null) return 0;
  if (entry.useCustomPayment) return 0;

  const month = entry.date.slice(0, 7);
  const sameMonthNonCustomCount = allCardEntries.filter(
    (e) => !e.useCustomPayment && e.cardId === card.id && e.date.slice(0, 7) === month,
  ).length;

  if (sameMonthNonCustomCount === 0) return 0;

  return card.monthlyTotal / sameMonthNonCustomCount;
}
