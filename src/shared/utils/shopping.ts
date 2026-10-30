import type { ShoppingItem } from '@/shared/types';

/** Longest item text, after trimming (spec 015 FR-003). */
export const SHOPPING_TEXT_MAX = 200;

/** The text as stored — trimmed — or `null` when it is blank or too long. */
export function normalizeShoppingText(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > SHOPPING_TEXT_MAX) return null;
  return text;
}

export interface ShoppingMonth {
  /** Still needed at the end of the month — oldest first. */
  needed: ShoppingItem[];
  /** Bought during the month — most recently bought first. */
  bought: ShoppingItem[];
}

/**
 * The list for month `period` (`YYYY-MM`) — spec 015 FR-005.
 *
 * An item is on month M's list from the month it was added until the month it
 * was bought, inclusive: `addedPeriod ≤ M` and (`boughtPeriod` unset or
 * `≥ M`). It shows as bought only in `boughtPeriod` itself. So an unbought item
 * carries over with no job copying it, an item bought in November still reads
 * as needed when looking back at October, and a future month lists only what
 * is still needed. `YYYY-MM` strings compare correctly as text.
 */
export function shoppingItemsForMonth(items: ShoppingItem[], period: string): ShoppingMonth {
  const needed: ShoppingItem[] = [];
  const bought: ShoppingItem[] = [];
  for (const item of items) {
    if (item.addedPeriod > period) continue;
    if (item.boughtPeriod === null || item.boughtPeriod > period) needed.push(item);
    else if (item.boughtPeriod === period) bought.push(item);
  }
  needed.sort((a, b) => compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id));
  bought.sort((a, b) => compareText(b.boughtAt ?? '', a.boughtAt ?? '') || compareText(a.id, b.id));
  return { needed, bought };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
