import type { ShoppingItem } from '@/shared/types';
import { currentPeriod, normalizeShoppingText } from '@/shared/utils';

import type { HourTrackDB } from '../schema';
import { deleteWithTombstone, nowIso, patchRow } from '../mutate';

/** Spec 015 — the shopping list rows, one per item. */

function validText(raw: string, fn: string): string {
  const text = normalizeShoppingText(raw);
  if (text === null) throw new Error(`${fn}: text must be 1–200 characters after trimming`);
  return text;
}

/**
 * ALL items. The page derives each month from this (a household list is tens
 * of rows), and the snapshot builder ships it. Sorted by `id` for a
 * deterministic snapshot.
 */
export async function getAllShoppingItems(db: HourTrackDB): Promise<ShoppingItem[]> {
  const rows = await db.shoppingItems.toArray();
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

/**
 * Add a needed item to a house in month `period` — the month on screen —
 * capped at the current LOCAL month (nothing is added in the future). Throws
 * on bad text.
 */
export async function addShoppingItem(
  db: HourTrackDB,
  cardId: string,
  rawText: string,
  period: string = currentPeriod(),
): Promise<ShoppingItem> {
  const text = validText(rawText, 'addShoppingItem');
  const now = nowIso();
  const row: ShoppingItem = {
    id: crypto.randomUUID(),
    cardId,
    text,
    addedPeriod: minPeriod(period, currentPeriod()),
    boughtAt: null,
    boughtPeriod: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.shoppingItems.add(row);
  return row;
}

export async function updateShoppingItemText(
  db: HourTrackDB,
  id: string,
  rawText: string,
): Promise<ShoppingItem> {
  const text = validText(rawText, 'updateShoppingItemText');
  return patchRow(db.shoppingItems, id, { text }, 'updateShoppingItemText: item not found');
}

/**
 * Tick an item bought in month `period` — the month on screen — or untick it.
 * The month is clamped to [the month it was added, the current LOCAL month]:
 * earlier would hide the item from every month, later is a purchase that has
 * not happened yet.
 */
export async function setShoppingItemBought(
  db: HourTrackDB,
  id: string,
  bought: boolean,
  period: string = currentPeriod(),
): Promise<ShoppingItem> {
  return db.transaction('rw', db.shoppingItems, async () => {
    const existing = await db.shoppingItems.get(id);
    if (!existing) throw new Error(`setShoppingItemBought: item not found: ${id}`);
    const patch = bought
      ? {
          boughtAt: nowIso(),
          boughtPeriod: maxPeriod(existing.addedPeriod, minPeriod(period, currentPeriod())),
        }
      : { boughtAt: null, boughtPeriod: null };
    return patchRow(db.shoppingItems, id, patch, 'setShoppingItemBought: item not found');
  });
}

// `YYYY-MM` strings order correctly as text.
function minPeriod(a: string, b: string): string {
  return a < b ? a : b;
}

function maxPeriod(a: string, b: string): string {
  return a > b ? a : b;
}

/**
 * Delete an item and record a `shoppingItem` tombstone so other devices drop
 * it too. Returns the deleted row, or `null` when there was none (idempotent).
 */
export async function deleteShoppingItem(
  db: HourTrackDB,
  id: string,
): Promise<ShoppingItem | null> {
  return deleteWithTombstone(db, db.shoppingItems, 'shoppingItem', id);
}
