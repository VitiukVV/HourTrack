/**
 * Spec 015 — one thing a house needs to have bought («White bags»).
 *
 * One row per item, not a list document per card: per-row LWW lets one device
 * tick an item while another adds one without either change being lost.
 *
 * Month membership is DERIVED, never copied (see `shoppingItemsForMonth`):
 * an item is on month M's list from `addedPeriod` until the month it was
 * bought. Both periods are stamped from the device's LOCAL date at write time,
 * so which month an item belongs to never depends on the reader's time zone.
 */
export interface ShoppingItem {
  /** uuid v4 generated client-side. */
  id: string;
  /** The house (client card) the item is for. */
  cardId: string;
  /** Trimmed, 1–`SHOPPING_TEXT_MAX` characters. */
  text: string;
  /** `YYYY-MM` — local month the item was added. */
  addedPeriod: string;
  /** ISO timestamp of the tick, or `null` while still needed. */
  boughtAt: string | null;
  /** `YYYY-MM` — local month of the tick; set and cleared with `boughtAt`. */
  boughtPeriod: string | null;
  createdAt: string;
  updatedAt: string;
}
