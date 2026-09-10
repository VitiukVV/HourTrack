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

/**
 * 001-cards-order-colors — Dexie v9 upgrade test.
 *
 * v9 does two things to the card rows, both non-destructive:
 *   1. Backfills `position = index * 1024` over the cards sorted by `id`.
 *      Sorting by `id` is not arbitrary: `db.cards…toArray()` returns rows in
 *      primary-key order, so the `id` sort reproduces exactly the order the
 *      app showed before this feature — which is what makes the upgrade
 *      invisible to the user (spec FR-008).
 *   2. Rewrites the retired sky-blue preset `#0284C7` to `#0C74B0`, the only
 *      colour change this feature ships (spec FR-010a).
 *
 * Strategy: seed a database pinned at v8, then re-open it through the
 * production `HourTrackDB` class (which declares v9) so Dexie applies the
 * real upgrade callback.
 */
describe('Dexie v9 upgrade — card position + sky-blue correction', () => {
  /** A v8 card row: the full Card shape minus `position`. */
  interface CardV8 {
    id: string;
    name: string;
    color: string;
    defaultDurationMin: number;
    defaultStartMinutes: number;
    rateType: 'hourly' | 'fixed' | 'monthly';
    hourlyRate: number | null;
    fixedTotal: number | null;
    monthlyTotal: number | null;
    defaultNote: string | null;
    isArchived: boolean;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }

  /**
   * A Dexie handle pinned at v8. Declaring only the v8 stores is enough:
   * Dexie stamps the database at version 8, which is all the upgrade path
   * needs, without restating v1..v7.
   */
  function makeV8Db(name: string): Dexie {
    const db = new Dexie(name);
    db.version(8).stores({
      cards: 'id, name, isArchived, updatedAt',
      entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
      settings: 'key',
      syncQueue: '++id, op, entityType, entityId, createdAt, nextAttemptAt',
      authTokens: 'key',
      tombstones: 'entityId, entityType, deletedAt',
      payments: 'id, cardId, period, [cardId+period], updatedAt',
      reminders: 'id, dueDate, doneAt, updatedAt',
    });
    return db;
  }

  function cardV8(id: string, name: string, color: string, isArchived = false): CardV8 {
    return {
      id,
      name,
      color,
      defaultDurationMin: 480,
      defaultStartMinutes: 600,
      rateType: 'hourly',
      hourlyRate: 50,
      fixedTotal: null,
      monthlyTotal: null,
      defaultNote: null,
      isArchived,
      archivedAt: isArchived ? '2026-08-01T10:00:00.000Z' : null,
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
    };
  }

  it('backfills position in id order, so the visible order does not change', async () => {
    const testName = `${DB_NAME}-v9-order`;
    const v8 = makeV8Db(testName);
    await v8.open();
    // Seeded out of id order on purpose: the upgrade must sort, not trust
    // insertion order.
    await v8
      .table<CardV8>('cards')
      .bulkAdd([
        cardV8('c-3', 'Anabel', '#7C3AED'),
        cardV8('c-1', 'Vacaciones', '#EA580C'),
        cardV8('c-2', 'Carlos', '#C026D3'),
      ]);
    v8.close();

    const v9 = new HourTrackDB(testName);
    await v9.open();
    const upgraded = await v9.cards.toArray();

    expect(upgraded).toHaveLength(3);
    for (const card of upgraded) {
      expect(Number.isFinite(card.position)).toBe(true);
    }
    // Positions follow the id sort, spaced for midpoint inserts.
    const byPosition = [...upgraded].sort((a, b) => a.position - b.position);
    expect(byPosition.map((c) => c.id)).toEqual(['c-1', 'c-2', 'c-3']);
    expect(byPosition.map((c) => c.position)).toEqual([0, 1024, 2048]);
    v9.close();
  });

  it('rewrites the retired sky blue and leaves every other colour alone', async () => {
    const testName = `${DB_NAME}-v9-sky`;
    const v8 = makeV8Db(testName);
    await v8.open();
    await v8
      .table<CardV8>('cards')
      .bulkAdd([
        cardV8('c-1', 'Old sky', '#0284C7'),
        cardV8('c-2', 'Teal', '#0D9488'),
        cardV8('c-3', 'Legacy pre-S19', '#EF4444'),
        cardV8('c-4', 'Archived old sky', '#0284C7', true),
      ]);
    v8.close();

    const v9 = new HourTrackDB(testName);
    await v9.open();
    const upgraded = await v9.cards.toArray();
    const byId = new Map(upgraded.map((c) => [c.id, c]));

    expect(byId.get('c-1')?.color).toBe('#0C74B0');
    // Archived cards are migrated too — they come back on restore.
    expect(byId.get('c-4')?.color).toBe('#0C74B0');
    expect(byId.get('c-2')?.color).toBe('#0D9488');
    // A pre-S19 legacy hex is NOT normalised: only the sky blue moves.
    expect(byId.get('c-3')?.color).toBe('#EF4444');
    v9.close();
  });

  it('preserves every other card field verbatim', async () => {
    const testName = `${DB_NAME}-v9-fields`;
    const seed = cardV8('c-1', 'Carlos', '#C026D3');
    const v8 = makeV8Db(testName);
    await v8.open();
    await v8.table<CardV8>('cards').bulkAdd([seed]);
    v8.close();

    const v9 = new HourTrackDB(testName);
    await v9.open();
    const upgraded = await v9.cards.get('c-1');

    expect(upgraded).toMatchObject(seed);
    v9.close();
  });

  it('upgrades an empty cards store without error', async () => {
    const testName = `${DB_NAME}-v9-empty`;
    const v8 = makeV8Db(testName);
    await v8.open();
    v8.close();

    const v9 = new HourTrackDB(testName);
    await v9.open();
    expect(await v9.cards.toArray()).toEqual([]);
    v9.close();
  });
});
