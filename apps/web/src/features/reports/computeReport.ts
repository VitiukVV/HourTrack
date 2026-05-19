import type { Card, Entry } from '@hourtrack/shared-types';
import { earningsForEntry, monthlyEarningsForPeriod } from '@hourtrack/shared-utils';

/**
 * Pure computation for the Reports page. Given a flat list of entries plus the
 * cards they reference plus the user's selectedCardIds filter, builds:
 *
 *   - `byEntry` — one row per filtered, non-orphan entry. Each row carries the
 *                 entry itself, its card, and the entry's earnings (computed
 *                 with the entry's full per-card history so fixed-rate
 *                 proportional splits land correctly). Rows are sorted by
 *                 `entry.date` ASC; ties broken by `entry.id` ASC for a
 *                 stable, deterministic order. Consumed by `ReportsTable` to
 *                 render Date / Project / Hours / Sum rows. For monthly-rate
 *                 cards (S21) the row's `earnings` is 0; ReportsTable renders
 *                 '—' in the Sum column for these rows.
 *
 *   - `byCard`  — one row per SELECTED CARD (cards with zero entries still
 *                 appear so the metrics card can still attribute totals to
 *                 known cards even when one had no activity). Sorted by
 *                 earnings descending (cards with zero earnings sort last).
 *                 Each row contains `card`, `durationMin`, `earnings`. The
 *                 totals card (`ReportsMetrics`) sums these. For monthly
 *                 cards, `earnings` carries the period-level retainer
 *                 contribution (NOT the per-entry sum, which would always
 *                 be 0).
 *
 *   - `totals`  — grand totals across the filtered entries. S21:
 *                 `totals.earnings = standardSum + monthlyContribution`.
 *
 *   - `monthlyContribution` (S21) — sum of `monthlyEarningsForPeriod()` for
 *                 every selected monthly card in `[periodStart, periodEnd]`.
 *                 Surfaced separately so consumers that care about the
 *                 breakdown (a future "explain my total" affordance) can
 *                 read it without recomputing.
 *
 * Fixed-rate earnings defer to `earningsForEntry` from `@hourtrack/shared-utils`:
 * each non-custom entry on a fixed-rate card earns the full `fixedTotal`
 * (flat per-entry amount). Custom-payment entries still use their own
 * `customPayment` value via the same helper. Reports does NOT recompute the
 * math inline.
 *
 * Monthly retainer aggregation defers to `monthlyEarningsForPeriod` from
 * `@hourtrack/shared-utils`. The retainer is billed once per calendar month
 * in `[periodStart, periodEnd]` that contains ≥1 entry for that card — see
 * the helper's docstring for the locked "no proration" semantics.
 *
 * Orphan defense: entries whose `cardId` does not appear in the `cards` list
 * are excluded entirely — they cannot produce a `byEntry` row (no card to
 * render) and cannot produce a `byCard` row (no card record to attribute
 * earnings to). Totals therefore exclude them as well; the alternative would
 * be inflating durations the user can't see in the table.
 *
 * S15 dropped `byDay`: it existed solely to feed the stacked bar chart's
 * x-axis. With the chart gone there is no consumer. If a future sprint
 * reintroduces a chart it can recompute from `byEntry`.
 */

export interface ReportByEntry {
  entry: Entry;
  card: Card;
  earnings: number;
}

export interface ReportByCard {
  card: Card;
  durationMin: number;
  earnings: number;
}

export interface ReportTotals {
  durationMin: number;
  earnings: number;
}

export interface ReportData {
  byEntry: ReportByEntry[];
  byCard: ReportByCard[];
  totals: ReportTotals;
  /**
   * S21 — Sum of monthly-card retainers contributed within
   * `[periodStart, periodEnd]`. Already folded into `totals.earnings`; the
   * field is also exposed standalone so consumers that want a breakdown
   * ("X EUR standard + Y EUR retainers") can render it.
   */
  monthlyContribution: number;
}

/**
 * S21 — Compute the Report. Signature change: now accepts `periodStart` and
 * `periodEnd` so monthly-rate cards can be aggregated at period scope.
 *
 * The caller (typically `useReportData`) MUST resolve the period bounds via
 * `rangeForReports(period, anchorDate, customStart, customEnd)` — DO NOT
 * pass raw `anchorDate`/`customStart`. The resolved bounds carry the same
 * snap-to-period-start/end semantics as the rest of Reports (week = Mon→Sun,
 * month = 1st→last, etc.).
 */
export function computeReport(
  entries: Entry[],
  cards: Card[],
  selectedCardIds: string[],
  periodStart: string,
  periodEnd: string,
): ReportData {
  const selectedSet = new Set(selectedCardIds);
  const cardsById = new Map(cards.map((c) => [c.id, c] as const));

  // Pre-filter entries to ones whose card is in the selected set AND whose
  // card record actually exists (orphan defense — see header comment).
  const filtered = entries.filter((e) => selectedSet.has(e.cardId) && cardsById.has(e.cardId));

  // ----- byCard --------------------------------------------------------------
  // Each selected card gets a row even if it has no entries in the filtered
  // set. Earnings for an entry require the matching card AND the entry's
  // full per-card history (for fixed-rate proportional split), so we group
  // first then iterate.
  const entriesByCard = new Map<string, Entry[]>();
  for (const entry of filtered) {
    const list = entriesByCard.get(entry.cardId);
    if (list) list.push(entry);
    else entriesByCard.set(entry.cardId, [entry]);
  }

  let monthlyContribution = 0;
  const byCard: ReportByCard[] = [];
  for (const cardId of selectedCardIds) {
    const card = cardsById.get(cardId);
    if (!card) {
      // selected ID with no matching Card record (e.g. user removed a card
      // mid-session) — skip so the table doesn't get a ghost row.
      continue;
    }
    const cardEntries = entriesByCard.get(cardId) ?? [];
    const durationMin = cardEntries.reduce((sum, e) => sum + e.durationMin, 0);
    // S21: split the earnings calculation by rateType so monthly cards use
    // the period-scoped retainer aggregator. Per-entry custom-payment
    // overrides on a monthly card still surface via `earningsForEntry`'s
    // custom-payment branch, so we ALSO walk the entries to capture them.
    let earnings = 0;
    if (card.rateType === 'monthly') {
      // Period-scoped retainer: at most one charge per billable month.
      const retainer = monthlyEarningsForPeriod(card, cardEntries, periodStart, periodEnd);
      // Per-entry custom-payment overrides ride on top of the retainer
      // (locked decision: custom payment is a one-off line item).
      const customSum = cardEntries
        .filter((e) => e.useCustomPayment)
        .reduce((sum, e) => sum + (e.customPayment ?? 0), 0);
      earnings = retainer + customSum;
      monthlyContribution += retainer;
    } else {
      earnings = cardEntries.reduce((sum, e) => sum + earningsForEntry(e, card, cardEntries), 0);
    }
    byCard.push({ card, durationMin, earnings });
  }
  byCard.sort((a, b) => b.earnings - a.earnings);

  // ----- byEntry -------------------------------------------------------------
  // One row per filtered entry, with per-row earnings computed against the
  // entry's per-card history so fixed-rate proportional splits agree
  // byte-for-byte with the byCard total above. Sorted by date ASC; within a
  // day, sorted by `startMinutes` ASC so the table reads top-to-bottom in
  // chronological time-of-day order; same-day + same-start entries fall
  // back to `entry.id` ASC for absolute stability across re-renders.
  //
  // S16b: switched the secondary tiebreak from `entry.id` to
  // `(startMinutes ASC, id ASC)` once `Entry.startMinutes` landed in S16.
  // The pre-S16b behavior (id-only tiebreak) is preserved as the tertiary
  // tiebreak for entries that happen to share a startMinutes value — that
  // path stays deterministic regardless of input ordering.
  //
  // S21: per-row earnings for monthly cards remain 0 here (the row's
  // visual rendering uses '—' via ReportsTable; the retainer is in the
  // byCard / totals). Custom-payment overrides on a monthly card still
  // surface their amount via the earningsForEntry custom-payment branch.
  const byEntry: ReportByEntry[] = filtered.map((entry) => {
    // cardsById.has(entry.cardId) is guaranteed by the filter above, so the
    // `!` here is asserting a known truth, not papering over a maybe.
    const card = cardsById.get(entry.cardId)!;
    const cardEntries = entriesByCard.get(entry.cardId) ?? [];
    return { entry, card, earnings: earningsForEntry(entry, card, cardEntries) };
  });
  byEntry.sort((a, b) => {
    if (a.entry.date !== b.entry.date) return a.entry.date < b.entry.date ? -1 : 1;
    if (a.entry.startMinutes !== b.entry.startMinutes) {
      return a.entry.startMinutes - b.entry.startMinutes;
    }
    return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
  });

  // ----- totals --------------------------------------------------------------
  // Sum from byCard so totals always agree with the metrics card byte-for-byte.
  // Orphan entries (cardId not in cards list) are already excluded above.
  // S21: monthly retainer contributions are already baked into each byCard
  // row's `earnings`, so summing byCard remains the source of truth. The
  // standalone `monthlyContribution` field surfaces the retainer breakdown.
  const totals: ReportTotals = byCard.reduce(
    (acc, row) => ({
      durationMin: acc.durationMin + row.durationMin,
      earnings: acc.earnings + row.earnings,
    }),
    { durationMin: 0, earnings: 0 },
  );

  return { byEntry, byCard, totals, monthlyContribution };
}
