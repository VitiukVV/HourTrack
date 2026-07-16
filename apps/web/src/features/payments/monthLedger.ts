import type { Card, Entry, Payment } from '@hourtrack/shared-types';
import {
  earningsForEntry,
  endOfMonth,
  formatLocalDate,
  monthlyEarningsForPeriod,
} from '@hourtrack/shared-utils';

/**
 * S27 — per-card monthly ledger for the Payments page.
 *
 * `computeMonthLedger(cards, entries, payments, period)` returns one row per
 * card that has ≥1 entry in `period` OR ≥1 payment for `period` (orphan
 * payments stay visible with `expected = 0`). Archived cards are included when
 * they match — the ledger is about money owed/received, not about whether a
 * card is still active.
 *
 * EXPECTED-AMOUNT REUSE (S0a decision): the `expected` amount routes ENTIRELY
 * through the existing pure earnings functions — zero re-implementation of
 * rate rules. A single uniform formula works for every rate type:
 *
 *     expected = monthlyEarningsForPeriod(card, monthEntries, start, end)
 *              + Σ earningsForEntry(entry, card, monthEntries)
 *
 * Why this is correct for each branch:
 *   - hourly / fixed  → `monthlyEarningsForPeriod` returns 0 (rateType guard),
 *                       so expected is the sum of per-entry earnings, matching
 *                       Reports' non-monthly `byCard` branch.
 *   - monthly         → `monthlyEarningsForPeriod` bills the retainer once for
 *                       the month (≥1 entry), and `earningsForEntry` returns 0
 *                       for non-custom monthly entries and the custom amount
 *                       for custom-payment entries — so the sum contributes
 *                       exactly the custom top-ups, matching Reports' monthly
 *                       branch (`retainer + customSum`).
 *
 * This keeps Payments and Reports numerically in lock-step (the worst failure
 * mode of this feature is divergence between the two).
 *
 * `received` = sum of the card's payments whose `period` matches — regardless
 * of `paidOn` (cash for July can arrive in August).
 */
export interface MonthLedgerRow {
  card: Card;
  /** EUR expected for the month, from the earnings model (see module doc). */
  expected: number;
  /** EUR received = sum of this card's payments for `period`. */
  received: number;
  /** Number of entries (work sessions) for this card in the month. */
  sessions: number;
  /** Total minutes worked for this card in the month. */
  totalMinutes: number;
  /** This card's payments for `period`, in the order supplied. */
  payments: Payment[];
}

/**
 * Build the ledger for a `'YYYY-MM'` period. Pure and framework-free.
 *
 * Rows are sorted by card name (locale-insensitive, case-insensitive) with the
 * card id as a stable tiebreaker so the list order is deterministic across
 * renders and test runs.
 */
export function computeMonthLedger(
  cards: Card[],
  entries: Entry[],
  payments: Payment[],
  period: string,
): MonthLedgerRow[] {
  const periodStart = `${period}-01`;
  const periodEnd = formatLocalDate(endOfMonth(periodStart));

  // Entries in the month, grouped by card. Month membership is the `YYYY-MM`
  // prefix of the local `date` (never toISOString slices — Entry.date is
  // already a local YYYY-MM-DD).
  const monthEntriesByCard = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (entry.date.slice(0, 7) !== period) continue;
    const list = monthEntriesByCard.get(entry.cardId);
    if (list) list.push(entry);
    else monthEntriesByCard.set(entry.cardId, [entry]);
  }

  // Payments for the period, grouped by card.
  const paymentsByCard = new Map<string, Payment[]>();
  for (const payment of payments) {
    if (payment.period !== period) continue;
    const list = paymentsByCard.get(payment.cardId);
    if (list) list.push(payment);
    else paymentsByCard.set(payment.cardId, [payment]);
  }

  const cardsById = new Map(cards.map((c) => [c.id, c] as const));

  // Union of card ids with entries OR payments this month. A payment
  // referencing a card that no longer exists (hard-deleted) can't render a
  // row (no card record) — skip it; such orphans are extremely rare and
  // flagged as a followup.
  const cardIds = new Set<string>([...monthEntriesByCard.keys(), ...paymentsByCard.keys()]);

  const rows: MonthLedgerRow[] = [];
  for (const cardId of cardIds) {
    const card = cardsById.get(cardId);
    if (!card) continue;

    const monthEntries = monthEntriesByCard.get(cardId) ?? [];
    const cardPayments = paymentsByCard.get(cardId) ?? [];

    const retainer = monthlyEarningsForPeriod(card, monthEntries, periodStart, periodEnd);
    const perEntry = monthEntries.reduce(
      (sum, entry) => sum + earningsForEntry(entry, card, monthEntries),
      0,
    );
    const expected = retainer + perEntry;

    const received = cardPayments.reduce((sum, p) => sum + p.amount, 0);
    const totalMinutes = monthEntries.reduce((sum, e) => sum + e.durationMin, 0);

    rows.push({
      card,
      expected,
      received,
      sessions: monthEntries.length,
      totalMinutes,
      payments: cardPayments,
    });
  }

  rows.sort((a, b) => {
    const byName = a.card.name.localeCompare(b.card.name, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0;
  });

  return rows;
}

/** Rollup totals for the month's ledger, consumed by the header strip. */
export interface LedgerTotals {
  expected: number;
  received: number;
  /** `max(expected - received, 0)` — money still owed. */
  outstanding: number;
}

export function ledgerTotals(rows: MonthLedgerRow[]): LedgerTotals {
  let expected = 0;
  let received = 0;
  for (const row of rows) {
    expected += row.expected;
    received += row.received;
  }
  return { expected, received, outstanding: Math.max(expected - received, 0) };
}
