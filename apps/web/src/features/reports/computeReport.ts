import type { Card, Entry } from '@hourtrack/shared-types';
import { earningsForEntry } from '@hourtrack/shared-utils';

/**
 * Pure computation for the Reports page. Given a flat list of entries plus the
 * cards they reference plus the user's selectedCardIds filter, builds:
 *
 *   - `byDay`   — one row per day THAT ACTUALLY HAS AT LEAST ONE ENTRY in the
 *                 filtered set (req #12: do not plot empty days).
 *                 Rows are sorted ascending by date.
 *                 Each row contains `durationMin` plus `perCardDurationMin`
 *                 (a plain object keyed by cardId) — consumed by the stacked
 *                 bar chart.
 *
 *   - `byCard`  — one row per SELECTED CARD (cards with zero entries still
 *                 appear so the table can show "no activity"). Sorted by
 *                 earnings descending (cards with zero earnings sort last).
 *                 Each row contains `card`, `durationMin`, `earnings`.
 *
 *   - `totals`  — grand totals across the filtered entries.
 *
 * Fixed-rate proportional distribution defers to `earningsForEntry` from
 * `@hourtrack/shared-utils` — the same function the EntryEditor live-preview
 * uses (S06), so there's exactly one place that "owns" the fixed-rate split
 * math. Reports does NOT recompute the split inline.
 *
 * Orphan defense: entries whose `cardId` does not appear in the `cards` list
 * still count toward `byDay` and `totals.durationMin`, but their earnings
 * default to zero (no card => can't compute rate). They do NOT produce a
 * `byCard` row, which keeps the table free of "ghost" entries.
 */

export interface ReportByDay {
  date: string;
  durationMin: number;
  perCardDurationMin: Record<string, number>;
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
  byDay: ReportByDay[];
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

  // Pre-filter entries to ones whose card is in the selected set.
  const filtered = entries.filter((e) => selectedSet.has(e.cardId));

  // ----- byDay ---------------------------------------------------------------
  // Skip entries whose card isn't in the cards list (orphan defense). Orphans
  // would otherwise inflate the per-day bar without contributing to byCard or
  // earnings, which is confusing for users staring at the chart.
  const dayBuckets = new Map<string, ReportByDay>();
  for (const entry of filtered) {
    if (!cardsById.has(entry.cardId)) continue;
    let row = dayBuckets.get(entry.date);
    if (!row) {
      row = { date: entry.date, durationMin: 0, perCardDurationMin: {} };
      dayBuckets.set(entry.date, row);
    }
    row.durationMin += entry.durationMin;
    row.perCardDurationMin[entry.cardId] =
      (row.perCardDurationMin[entry.cardId] ?? 0) + entry.durationMin;
  }
  const byDay = [...dayBuckets.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

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

  // ----- totals --------------------------------------------------------------
  // Sum from byCard so totals always agree with the table + pie chart byte-for-byte.
  // Orphan entries (cardId not in cards list) are excluded from both byDay and
  // totals — they can't be attributed to anything meaningful in the UI.
  const totals: ReportTotals = byCard.reduce(
    (acc, row) => ({
      durationMin: acc.durationMin + row.durationMin,
      earnings: acc.earnings + row.earnings,
    }),
    { durationMin: 0, earnings: 0 },
  );

  return { byDay, byCard, totals };
}
