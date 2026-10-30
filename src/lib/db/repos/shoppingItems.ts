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

/** Add a needed item to a house, in the current LOCAL month. Throws on bad text. */
export async function addShoppingItem(
  db: HourTrackDB,
  cardId: string,
  rawText: string,
): Promise<ShoppingItem> {
  const text = validText(rawText, 'addShoppingItem');
  const now = nowIso();
  const row: ShoppingItem = {
    id: crypto.randomUUID(),
    cardId,
    text,
    addedPeriod: currentPeriod(),
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

/** Tick (into the current LOCAL month) or untick an item. */
export async function setShoppingItemBought(
  db: HourTrackDB,
  id: string,
  bought: boolean,
): Promise<ShoppingItem> {
  const patch = bought
    ? { boughtAt: nowIso(), boughtPeriod: currentPeriod() }
    : { boughtAt: null, boughtPeriod: null };
  return patchRow(db.shoppingItems, id, patch, 'setShoppingItemBought: item not found');
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
