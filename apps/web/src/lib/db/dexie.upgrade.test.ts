/**
 * S21 — Dexie v6 upgrade test.
 *
 * v6 (S21) adds `monthlyTotal: number | null` to the Card row. The upgrade
 * callback is non-destructive: it walks every card and sets
 * `monthlyTotal = null` for rows that predate the field. All other card
 * fields are preserved verbatim.
 *
 * Strategy:
 *   1. Open the database at a pinned v5 schema (no monthlyTotal awareness)
 *      and seed it with three cards in the legacy shape: hourly, fixed, and
 *      archived-hourly.
 *   2. Close that handle.
 *   3. Re-open the SAME named database via the full `HourTrackDB` class
 *      (which declares versions 1..6). Dexie applies the v5 → v6 upgrade
 *      automatically on `.open()`.
 *   4. Assert that all three cards still exist and now carry
 *      `monthlyTotal === null`. No other field is touched.
 */
import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HourTrackDB } from './schema';

const DB_NAME = `hourtrack-upgrade-${Math.random().toString(36).slice(2)}`;

// Row shape as it existed at v5 (before S21's `monthlyTotal` field landed).
interface CardV5 {
  id: string;
  name: string;
  color: string;
  defaultDurationMin: number;
  defaultStartMinutes: number;
  rateType: 'hourly' | 'fixed';
  hourlyRate: number | null;
  fixedTotal: number | null;
  defaultNote: string | null;
  isArchived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Build a minimal Dexie handle pinned at v5 so we can seed legacy-shape
 * rows. We deliberately mirror the v5 store definition from `schema.ts` so
 * the seeded DB is bit-identical to a real upgrade-from-prior-build
 * scenario.
 */
function makeV5Db(name: string): Dexie {
  const db = new Dexie(name);
  db.version(1).stores({
    cards: 'id, name, isArchived, updatedAt',
    entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
    settings: 'key',
    syncQueue: '++id, op, entityType, entityId, createdAt',
  });
  db.version(2).stores({
    cards: 'id, name, isArchived, updatedAt',
    entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
    settings: 'key',
    syncQueue: '++id, op, entityType, entityId, createdAt',
    authTokens: 'key',
  });
  db.version(3).stores({
    cards: 'id, name, isArchived, updatedAt',
    entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
    settings: 'key',
    syncQueue: '++id, op, entityType, entityId, createdAt, nextAttemptAt',
    authTokens: 'key',
    tombstones: 'entityId, entityType, deletedAt',
  });
  db.version(4).stores({
    cards: 'id, name, isArchived, updatedAt',
    entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
    settings: 'key',
    syncQueue: '++id, op, entityType, entityId, createdAt, nextAttemptAt',
    authTokens: 'key',
    tombstones: 'entityId, entityType, deletedAt',
  });
  db.version(5).stores({
    cards: 'id, name, isArchived, updatedAt',
    entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
    settings: 'key',
    syncQueue: '++id, op, entityType, entityId, createdAt, nextAttemptAt',
    authTokens: 'key',
    tombstones: 'entityId, entityType, deletedAt',
  });
  return db;
}

let testName: string;
beforeEach(() => {
  testName = `${DB_NAME}-${Math.random().toString(36).slice(2)}`;
});

afterEach(async () => {
  await Dexie.delete(testName);
});

describe('Dexie v5 → v6 upgrade (S21)', () => {
  it('backfills monthlyTotal: null on every existing card and preserves all other fields', async () => {
    // 1. Seed a v5 DB with three cards covering hourly / fixed / archived.
    const v5 = makeV5Db(testName);
    await v5.open();
    const legacyCards: CardV5[] = [
      {
        id: 'hourly-1',
        name: 'Hourly',
        color: '#2563EB',
        defaultDurationMin: 480,
        defaultStartMinutes: 600,
        rateType: 'hourly',
        hourlyRate: 20,
        fixedTotal: null,
        defaultNote: 'note',
        isArchived: false,
        archivedAt: null,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
      {
        id: 'fixed-1',
        name: 'Fixed',
        color: '#DC2626',
        defaultDurationMin: 240,
        defaultStartMinutes: 540,
        rateType: 'fixed',
        hourlyRate: null,
        fixedTotal: 1200,
        defaultNote: null,
        isArchived: false,
        archivedAt: null,
        createdAt: '2026-05-02T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:00.000Z',
      },
      {
        id: 'archived-1',
        name: 'Archived',
        color: '#16A34A',
        defaultDurationMin: 60,
        defaultStartMinutes: 600,
        rateType: 'hourly',
        hourlyRate: 15,
        fixedTotal: null,
        defaultNote: null,
        isArchived: true,
        archivedAt: '2026-05-03T12:00:00.000Z',
        createdAt: '2026-05-03T00:00:00.000Z',
        updatedAt: '2026-05-03T12:00:00.000Z',
      },
    ];
    await v5.table('cards').bulkAdd(legacyCards);

    // Sanity: the v5 rows do NOT carry monthlyTotal yet.
    const rawBefore = (await v5.table('cards').toArray()) as Array<Record<string, unknown>>;
    expect(rawBefore).toHaveLength(3);
    for (const row of rawBefore) {
      expect('monthlyTotal' in row).toBe(false);
    }
    v5.close();

    // 2. Re-open under the production `HourTrackDB` class (declares v6 +
    //    its upgrade callback). Dexie auto-applies the v5 → v6 migration.
    const v6 = new HourTrackDB(testName);
    await v6.open();

    // 3. Assert all three cards still present with backfilled monthlyTotal.
    const upgraded = await v6.cards.toArray();
    upgraded.sort((a, b) => a.id.localeCompare(b.id));
    expect(upgraded).toHaveLength(3);

    const [archived, fixed, hourly] = upgraded;
    expect(archived?.id).toBe('archived-1');
    expect(fixed?.id).toBe('fixed-1');
    expect(hourly?.id).toBe('hourly-1');

    // monthlyTotal is null on every row.
    expect(archived?.monthlyTotal).toBeNull();
    expect(fixed?.monthlyTotal).toBeNull();
    expect(hourly?.monthlyTotal).toBeNull();

    // All other fields preserved verbatim.
    expect(archived?.isArchived).toBe(true);
    expect(archived?.archivedAt).toBe('2026-05-03T12:00:00.000Z');
    expect(fixed?.fixedTotal).toBe(1200);
    expect(fixed?.rateType).toBe('fixed');
    expect(fixed?.hourlyRate).toBeNull();
    expect(hourly?.hourlyRate).toBe(20);
    expect(hourly?.rateType).toBe('hourly');
    expect(hourly?.fixedTotal).toBeNull();
    expect(hourly?.defaultNote).toBe('note');

    v6.close();
  });

  it('is a no-op for a fresh v6 DB (no cards to backfill, no crash)', async () => {
    // Opening the production class against a never-seeded database name
    // also exercises the v6 upgrade hook — it iterates an empty cards
    // collection and completes successfully.
    const db = new HourTrackDB(testName);
    await db.open();
    const cards = await db.cards.toArray();
    expect(cards).toEqual([]);
    db.close();
  });
});
