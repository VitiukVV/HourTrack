import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DriveSnapshot, Settings, ShoppingItem } from '@/shared/types';

import { HourTrackDB } from '@/lib/db/schema';
import { addShoppingItem, deleteShoppingItem, getAllShoppingItems, initDB } from '@/lib/db/queries';
import { lwwMerge } from '@/features/sync/lwwMerge';

import { applySnapshot, buildSnapshot } from './snapshot';
import { validateSnapshot } from './validateSnapshot';

let db: HourTrackDB;

function freshDb(tag: string): HourTrackDB {
  return new HourTrackDB(`hourtrack-snap-shop-${tag}-${Math.random().toString(36).slice(2)}`);
}

beforeEach(async () => {
  db = freshDb('a');
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

const NOW = new Date('2026-10-30T12:00:00.000Z');

function settings(): Settings {
  return {
    language: 'uk',
    theme: 'system',
    defaultView: 'month',
    hourtrackCalendarId: null,
    autoBackupEnabled: true,
    autoBackupIntervalDays: 3,
    lastBackupAt: null,
    lastSyncAt: null,
    firstLoginAt: null,
    deviceId: null,
    driveDataFileId: null,
    driveDataEtag: null,
    onboardingSeen: false,
  };
}

function item(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: 'i1',
    cardId: 'c1',
    text: 'White bags',
    addedPeriod: '2026-10',
    boughtAt: null,
    boughtPeriod: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function snap(overrides: Partial<DriveSnapshot> = {}): DriveSnapshot {
  return {
    schemaVersion: 8,
    exportedAt: '2026-10-30T00:00:00.000Z',
    deviceId: 'dev',
    settings: settings(),
    cards: [],
    entries: [],
    payments: [],
    reminders: [],
    monthAdjustments: [],
    shoppingItems: [],
    tombstones: [],
    ...overrides,
  };
}

describe('snapshot v8 — shopping items (spec 015)', () => {
  it('buildSnapshot emits v8 with items and round-trips into a fresh db', async () => {
    const row = await addShoppingItem(db, 'c1', 'White bags');
    const built = await buildSnapshot(db);
    expect(built.schemaVersion).toBe(8);
    expect(built.shoppingItems).toEqual([row]);

    const validated = validateSnapshot(JSON.parse(JSON.stringify(built)));
    expect(validated.ok).toBe(true);

    const db2 = freshDb('b');
    await db2.open();
    await initDB(db2);
    const result = await applySnapshot(built, db2);
    expect(result.shoppingItems).toBe(1);
    expect(await getAllShoppingItems(db2)).toEqual([row]);
    await db2.delete();
  });

  it('a v7 snapshot validates with an empty shopping list', () => {
    const v7 = { ...snap(), schemaVersion: 7 } as Record<string, unknown>;
    delete v7.shoppingItems;
    const result = validateSnapshot(v7);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.schemaVersion).toBe(8);
      expect(result.snapshot.shoppingItems).toEqual([]);
    }
  });

  it('rejects a row bought in no month, blank text or a bad period', () => {
    const broken = [
      item({ boughtAt: NOW.toISOString(), boughtPeriod: null }),
      item({ text: '   ' }),
      item({ addedPeriod: '2026-13' }),
    ];
    for (const row of broken) {
      expect(validateSnapshot(snap({ shoppingItems: [row] })).ok).toBe(false);
    }
  });

  it('replace-mode restore wipes items the backup does not have', async () => {
    await addShoppingItem(db, 'c1', 'Bags');
    await applySnapshot(snap(), db);
    expect(await getAllShoppingItems(db)).toEqual([]);
  });

  it('lwwMerge resolves each item on its own: a tick here, a new item there', () => {
    const local = snap({
      shoppingItems: [
        item({
          boughtAt: '2026-10-20T00:00:00.000Z',
          boughtPeriod: '2026-10',
          updatedAt: '2026-10-20T00:00:00.000Z',
        }),
      ],
    });
    const remote = snap({
      shoppingItems: [
        item(),
        item({ id: 'i2', text: 'Soap', updatedAt: '2026-10-21T00:00:00.000Z' }),
      ],
    });
    const { snapshot } = lwwMerge(local, remote, { now: NOW });
    expect(snapshot.shoppingItems).toEqual([
      expect.objectContaining({ id: 'i1', boughtPeriod: '2026-10' }),
      expect.objectContaining({ id: 'i2', text: 'Soap' }),
    ]);
  });

  it('lwwMerge keeps the later text edit of the same item', () => {
    const local = snap({ shoppingItems: [item({ updatedAt: '2026-10-10T00:00:00.000Z' })] });
    const remote = snap({
      shoppingItems: [item({ text: 'Black bags', updatedAt: '2026-10-11T00:00:00.000Z' })],
    });
    const { snapshot } = lwwMerge(local, remote, { now: NOW });
    expect(snapshot.shoppingItems).toEqual([expect.objectContaining({ text: 'Black bags' })]);
  });

  it('a delete on one device is not revived by an older copy on the other', async () => {
    const row = await addShoppingItem(db, 'c1', 'Bags');
    await deleteShoppingItem(db, row.id);
    const local = await buildSnapshot(db);
    const remote = snap({ shoppingItems: [row] });

    const { snapshot } = lwwMerge(local, remote, { now: new Date() });
    expect(snapshot.shoppingItems).toEqual([]);
    expect(snapshot.tombstones).toContainEqual(
      expect.objectContaining({ entityId: row.id, entityType: 'shoppingItem' }),
    );
  });
});
