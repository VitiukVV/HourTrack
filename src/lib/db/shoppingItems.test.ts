import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HourTrackDB } from './schema';
import {
  addShoppingItem,
  createCard,
  deleteCardPermanently,
  deleteShoppingItem,
  getAllShoppingItems,
  getAllTombstones,
  initDB,
  setShoppingItemBought,
  updateShoppingItemText,
} from './queries';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-shop-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  vi.useRealTimers();
  await db.delete();
});

async function seedCard(id = 'c1') {
  return createCard(db, {
    id,
    name: 'Raquel',
    color: '#2563EB',
    position: 0,
    defaultDurationMin: 150,
    defaultStartMinutes: 540,
    rateType: 'hourly',
    hourlyRate: 12,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
  });
}

describe('shopping items repo', () => {
  it('adds a trimmed, needed item stamped with the local month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 23:30 local on Oct 31 — must stay October whatever the UTC date is.
    vi.setSystemTime(new Date(2026, 9, 31, 23, 30));
    const row = await addShoppingItem(db, 'c1', '  White bags  ');

    expect(row).toMatchObject({
      cardId: 'c1',
      text: 'White bags',
      addedPeriod: '2026-10',
      boughtAt: null,
      boughtPeriod: null,
    });
    expect(await getAllShoppingItems(db)).toEqual([row]);
  });

  it('rejects blank and oversized text', async () => {
    await expect(addShoppingItem(db, 'c1', '   ')).rejects.toThrow();
    await expect(addShoppingItem(db, 'c1', 'x'.repeat(201))).rejects.toThrow();
    const row = await addShoppingItem(db, 'c1', 'Soap');
    await expect(updateShoppingItemText(db, row.id, ' ')).rejects.toThrow();
    expect(await getAllShoppingItems(db)).toHaveLength(1);
  });

  it('edits the text and bumps updatedAt', async () => {
    const row = await addShoppingItem(db, 'c1', 'Soap');
    const edited = await updateShoppingItemText(db, row.id, ' Liquid soap ');
    expect(edited.text).toBe('Liquid soap');
    expect(edited.createdAt).toBe(row.createdAt);
    expect(edited.updatedAt >= row.updatedAt).toBe(true);
  });

  it('ticks an item into the current local month and unticks it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 3, 9, 0));
    const row = await addShoppingItem(db, 'c1', 'Bags');

    const ticked = await setShoppingItemBought(db, row.id, true);
    expect(ticked.boughtPeriod).toBe('2026-11');
    expect(ticked.boughtAt).not.toBeNull();

    const unticked = await setShoppingItemBought(db, row.id, false);
    expect(unticked.boughtPeriod).toBeNull();
    expect(unticked.boughtAt).toBeNull();
  });

  it('deletes with a shoppingItem tombstone', async () => {
    const row = await addShoppingItem(db, 'c1', 'Bags');
    expect(await deleteShoppingItem(db, row.id)).toEqual(row);
    expect(await getAllShoppingItems(db)).toEqual([]);
    expect(await getAllTombstones(db)).toEqual([
      expect.objectContaining({ entityId: row.id, entityType: 'shoppingItem' }),
    ]);
    expect(await deleteShoppingItem(db, row.id)).toBeNull();
  });

  it('cascades items with tombstones when the house is deleted for good', async () => {
    await seedCard('c1');
    await seedCard('c2');
    const gone = await addShoppingItem(db, 'c1', 'Bags');
    const kept = await addShoppingItem(db, 'c2', 'Soap');

    await deleteCardPermanently(db, 'c1');

    expect(await getAllShoppingItems(db)).toEqual([kept]);
    expect(await getAllTombstones(db)).toContainEqual(
      expect.objectContaining({ entityId: gone.id, entityType: 'shoppingItem' }),
    );
  });
});
