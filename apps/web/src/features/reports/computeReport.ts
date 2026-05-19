import type { Card, Entry } from '@hourtrack/shared-types';
import { earningsForEntry, monthlyEarningsPerEntry } from '@hourtrack/shared-utils';

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
 *   - `monthlyContribution` — sum of the per-entry retainer shares across
 *                 every selected monthly card visible in [periodStart,
 *                 periodEnd]. Surfaced separately so consumers that want a
 *                 breakdown ("X EUR standard + Y EUR retainers") can read it.
 *
 * Fixed-rate earnings defer to `earningsForEntry` from `@hourtrack/shared-utils`:
 * each non-custom entry on a fixed-rate card earns the full `fixedTotal`
 * (flat per-entry amount). Custom-payment entries still use their own
 * `customPayment` value via the same helper. Reports does NOT recompute the
 * math inline.
 *
 * Monthly retainer rows defer to `monthlyEarningsPerEntry` from
 * `@hourtrack/shared-utils`. Each visible non-custom monthly entry shows
 * `monthlyTotal / count(non-custom entries of that card in its calendar
 * month)` — the denominator is computed against the WIDER per-card scope
 * (the union of full calendar months that touch the period) so the share
 * stays stable when the filter narrows to a week / day inside the month.
 * Callers MUST pass `entries` covering that wider scope; `useReportData`
 * snaps the query range to month boundaries for exactly this reason.
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
  // `entries` may come in wider than [periodStart, periodEnd] — callers
  // like `useReportData` pass the union of full calendar months that
  // overlap the period so monthly-rate per-entry denominators see every
  // entry in the entry's month. We keep that wider scope as
  // `selectedAllScope` (used for the monthly denominator) and additionally
  // narrow to the visible period for byEntry / byCard rendering.
  const selectedAllScope = entries.filter(
    (e) => selectedSet.has(e.cardId) && cardsById.has(e.cardId),
  );
  const filtered = selectedAllScope.filter((e) => e.date >= periodStart && e.date <= periodEnd);

  // ----- byCard --------------------------------------------------------------
  // Each selected card gets a row even if it has no entries in the filtered
  // set. Group entries by card so we walk each card's set once.
  const entriesByCard = new Map<string, Entry[]>();
  for (const entry of filtered) {
    const list = entriesByCard.get(entry.cardId);
    if (list) list.push(entry);
    else entriesByCard.set(entry.cardId, [entry]);
  }
  // Wider scope grouped by card — for monthly per-entry denominators (so the
  // count reflects the full calendar month even when the filter narrows the
  // visible set).
  const scopeEntriesByCard = new Map<string, Entry[]>();
  for (const entry of selectedAllScope) {
    const list = scopeEntriesByCard.get(entry.cardId);
    if (list) list.push(entry);
    else scopeEntriesByCard.set(entry.cardId, [entry]);
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
    const scopeForCard = scopeEntriesByCard.get(cardId) ?? [];
    const durationMin = cardEntries.reduce((sum, e) => sum + e.durationMin, 0);
    let earnings = 0;
    if (card.rateType === 'monthly') {
      // Sum the visible entries' per-entry shares. Each visible non-custom
      // entry's share is `monthlyTotal / count(non-custom entries of this
      // card in its calendar month)` (denominator pulled from the wider
      // scope). Custom-payment entries ride on top with their own amount.
      let retainer = 0;
      for (const entry of cardEntries) {
        if (entry.useCustomPayment) continue;
        retainer += monthlyEarningsPerEntry(entry, card, scopeForCard);
      }
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
  // One row per visible entry. Sorted by date ASC; within a day, by
  // `startMinutes` ASC; same-day + same-start entries fall back to
  // `entry.id` ASC for absolute stability across re-renders.
  //
  // Monthly-rate non-custom rows pull their share from `monthlyEarningsPerEntry`
  // using the wider per-card scope so the denominator reflects the FULL
  // calendar month (not just the visible filter). Custom-payment entries
  // route through `earningsForEntry` so they surface their own amount.
  const byEntry: ReportByEntry[] = filtered.map((entry) => {
    // cardsById.has(entry.cardId) is guaranteed by the filter above, so the
    // `!` here is asserting a known truth, not papering over a maybe.
    const card = cardsById.get(entry.cardId)!;
    const cardEntries = entriesByCard.get(entry.cardId) ?? [];
    const scopeForCard = scopeEntriesByCard.get(entry.cardId) ?? [];
    const earnings =
      card.rateType === 'monthly' && !entry.useCustomPayment
        ? monthlyEarningsPerEntry(entry, card, scopeForCard)
        : earningsForEntry(entry, card, cardEntries);
    return { entry, card, earnings };
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
