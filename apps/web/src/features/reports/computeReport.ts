import type { Card, Entry } from '@hourtrack/shared-types';
import { earningsForEntry } from '@hourtrack/shared-utils';

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
 *                 render Date / Project / Hours / Sum rows.
 *
 *   - `byCard`  — one row per SELECTED CARD (cards with zero entries still
 *                 appear so the metrics card can still attribute totals to
 *                 known cards even when one had no activity). Sorted by
 *                 earnings descending (cards with zero earnings sort last).
 *                 Each row contains `card`, `durationMin`, `earnings`. The
 *                 totals card (`ReportsMetrics`) sums these.
 *
 *   - `totals`  — grand totals across the filtered entries.
 *
 * Fixed-rate proportional distribution defers to `earningsForEntry` from
 * `@hourtrack/shared-utils` — the same function the EntryEditor live-preview
 * uses (S06), so there's exactly one place that "owns" the fixed-rate split
 * math. Reports does NOT recompute the split inline.
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
}

export function computeReport(
  entries: Entry[],
  cards: Card[],
  selectedCardIds: string[],
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
    const earnings = cardEntries.reduce(
      (sum, e) => sum + earningsForEntry(e, card, cardEntries),
      0,
    );
    byCard.push({ card, durationMin, earnings });
  }
  byCard.sort((a, b) => b.earnings - a.earnings);

  // ----- byEntry -------------------------------------------------------------
  // One row per filtered entry, with per-row earnings computed against the
  // entry's per-card history so fixed-rate proportional splits agree
  // byte-for-byte with the byCard total above. Sorted by date ASC; secondary
  // tiebreak by entry.id so the order is deterministic across re-renders.
  // S16 will introduce `entry.startMinutes` and the tiebreak switches to
  // startMinutes ASC at that point — the test for that lives in S16.
  const byEntry: ReportByEntry[] = filtered.map((entry) => {
    // cardsById.has(entry.cardId) is guaranteed by the filter above, so the
    // `!` here is asserting a known truth, not papering over a maybe.
    const card = cardsById.get(entry.cardId)!;
    const cardEntries = entriesByCard.get(entry.cardId) ?? [];
    return { entry, card, earnings: earningsForEntry(entry, card, cardEntries) };
  });
  byEntry.sort((a, b) => {
    if (a.entry.date !== b.entry.date) return a.entry.date < b.entry.date ? -1 : 1;
    return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
  });

  // ----- totals --------------------------------------------------------------
  // Sum from byCard so totals always agree with the metrics card byte-for-byte.
  // Orphan entries (cardId not in cards list) are already excluded above.
  const totals: ReportTotals = byCard.reduce(
    (acc, row) => ({
      durationMin: acc.durationMin + row.durationMin,
      earnings: acc.earnings + row.earnings,
    }),
    { durationMin: 0, earnings: 0 },
  );

  return { byEntry, byCard, totals };
}
