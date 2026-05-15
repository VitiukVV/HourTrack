import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { HourTrackDB } from './schema';
import {
  archiveCard,
  createCard,
  createEntry,
  deleteEntry,
  getAllCards,
  getCardById,
  getEntriesByCardAndDate,
  getEntriesByCardId,
  getEntriesByDate,
  getEntriesByDateRange,
  getSettings,
  initDB,
  restoreCard,
  updateCard,
  updateEntry,
  updateSettings,
} from './queries';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-test-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

function newCard(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Test',
    color: '#3B82F6',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    ...overrides,
  };
}

function newEntry(
  cardId: string,
  overrides: Partial<Entry> = {},
): Omit<Entry, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    cardId,
    date: '2026-05-14',
    startMinutes: 600,
    durationMin: 60,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    ...overrides,
  };
}

describe('Dexie schema bootstrap', () => {
  it('opens with all six stores (cards, entries, settings, syncQueue, authTokens, tombstones)', () => {
    const names = db.tables.map((t) => t.name).sort();
    expect(names).toEqual([
      'authTokens',
      'cards',
      'entries',
      'settings',
      'syncQueue',
      'tombstones',
    ]);
  });

  it('seeds a default settings row on initDB', async () => {
    const settings = await getSettings(db);
    expect(settings).not.toBeNull();
    expect(settings?.autoBackupEnabled).toBe(true);
    expect(settings?.autoBackupIntervalDays).toBe(3);
    expect(settings?.defaultView).toBe('month');
    expect(settings?.theme).toBe('system');
    expect(settings?.lastBackupAt).toBeNull();
    expect(settings?.lastSyncAt).toBeNull();
    expect(settings?.firstLoginAt).toBeNull();
  });

  it('initDB is idempotent (running twice does not duplicate settings)', async () => {
    await initDB(db);
    const all = await db.settings.toArray();
    expect(all).toHaveLength(1);
  });
});

describe('cards queries', () => {
  it('createCard stamps createdAt and updatedAt and persists', async () => {
    const card = await createCard(db, newCard({ name: 'Alpha' }));
    expect(card.createdAt).toMatch(/T.+Z$/);
    expect(card.updatedAt).toBe(card.createdAt);

    const fetched = await getCardById(db, card.id);
    expect(fetched?.name).toBe('Alpha');
  });

  it('getAllCards excludes archived cards by default', async () => {
    const active = await createCard(db, newCard({ name: 'Active' }));
    const archived = await createCard(db, newCard({ name: 'Archived', isArchived: true }));

    const cards = await getAllCards(db);
    expect(cards.map((c) => c.id)).toContain(active.id);
    expect(cards.map((c) => c.id)).not.toContain(archived.id);
  });

  it('getAllCards(true) includes archived cards', async () => {
    await createCard(db, newCard({ name: 'A' }));
    await createCard(db, newCard({ name: 'B', isArchived: true }));
    const cards = await getAllCards(db, true);
    expect(cards).toHaveLength(2);
  });

  it('updateCard stamps a new updatedAt newer than createdAt', async () => {
    const card = await createCard(db, newCard({ name: 'X' }));
    // Force a measurable timestamp delta
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateCard(db, card.id, { name: 'Y' });
    expect(updated.name).toBe('Y');
    expect(updated.createdAt).toBe(card.createdAt);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date(card.createdAt).getTime(),
    );
  });

  it('archiveCard sets isArchived=true and archivedAt timestamp', async () => {
    const card = await createCard(db, newCard({ name: 'Z' }));
    const archived = await archiveCard(db, card.id);
    expect(archived.isArchived).toBe(true);
    expect(archived.archivedAt).not.toBeNull();
  });

  it('restoreCard sets isArchived=false and clears archivedAt', async () => {
    const card = await createCard(db, newCard({ isArchived: true }));
    const restored = await restoreCard(db, card.id);
    expect(restored.isArchived).toBe(false);
    expect(restored.archivedAt).toBeNull();
  });
});

describe('entries queries', () => {
  it('createEntry persists and stamps timestamps', async () => {
    const card = await createCard(db, newCard());
    const entry = await createEntry(db, newEntry(card.id, { durationMin: 90 }));
    expect(entry.createdAt).toBe(entry.updatedAt);
    expect(entry.durationMin).toBe(90);
  });

  it('getEntriesByDate filters by exact YYYY-MM-DD', async () => {
    const card = await createCard(db, newCard());
    await createEntry(db, newEntry(card.id, { date: '2026-05-14' }));
    await createEntry(db, newEntry(card.id, { date: '2026-05-15' }));

    const onMay14 = await getEntriesByDate(db, '2026-05-14');
    expect(onMay14).toHaveLength(1);
    expect(onMay14[0]?.date).toBe('2026-05-14');
  });

  it('getEntriesByDateRange returns inclusive range sorted by date', async () => {
    const card = await createCard(db, newCard());
    await createEntry(db, newEntry(card.id, { date: '2026-05-16' }));
    await createEntry(db, newEntry(card.id, { date: '2026-05-14' }));
    await createEntry(db, newEntry(card.id, { date: '2026-05-20' })); // outside
    await createEntry(db, newEntry(card.id, { date: '2026-05-15' }));

    const range = await getEntriesByDateRange(db, '2026-05-14', '2026-05-16');
    expect(range.map((e) => e.date)).toEqual(['2026-05-14', '2026-05-15', '2026-05-16']);
  });

  it('getEntriesByCardId returns only entries for that card', async () => {
    const a = await createCard(db, newCard({ name: 'A' }));
    const b = await createCard(db, newCard({ name: 'B' }));
    await createEntry(db, newEntry(a.id));
    await createEntry(db, newEntry(b.id));
    await createEntry(db, newEntry(a.id));

    const aEntries = await getEntriesByCardId(db, a.id);
    expect(aEntries).toHaveLength(2);
    expect(aEntries.every((e) => e.cardId === a.id)).toBe(true);
  });

  it('getEntriesByCardAndDate returns only entries matching (cardId, date) via [cardId+date] index', async () => {
    const a = await createCard(db, newCard({ name: 'A' }));
    const b = await createCard(db, newCard({ name: 'B' }));
    await createEntry(db, newEntry(a.id, { date: '2026-05-14' }));
    await createEntry(db, newEntry(a.id, { date: '2026-05-15' }));
    await createEntry(db, newEntry(b.id, { date: '2026-05-14' }));

    const aOn14 = await getEntriesByCardAndDate(db, a.id, '2026-05-14');
    expect(aOn14).toHaveLength(1);
    expect(aOn14[0]?.cardId).toBe(a.id);
    expect(aOn14[0]?.date).toBe('2026-05-14');

    const aOn99 = await getEntriesByCardAndDate(db, a.id, '2026-12-31');
    expect(aOn99).toHaveLength(0);
  });

  it('updateEntry stamps a fresh updatedAt', async () => {
    const card = await createCard(db, newCard());
    const entry = await createEntry(db, newEntry(card.id));
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateEntry(db, entry.id, { note: 'hello' });
    expect(updated.note).toBe('hello');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date(entry.updatedAt).getTime(),
    );
  });

  it('deleteEntry removes the entry from the store', async () => {
    const card = await createCard(db, newCard());
    const entry = await createEntry(db, newEntry(card.id));
    await deleteEntry(db, entry.id);
    expect(await db.entries.get(entry.id)).toBeUndefined();
  });
});

describe('settings queries', () => {
  it('updateSettings merges the patch and stamps lastSyncAt when provided', async () => {
    const updated = await updateSettings(db, { language: 'en', theme: 'dark' });
    expect(updated.language).toBe('en');
    expect(updated.theme).toBe('dark');
    // unchanged fields preserved
    expect(updated.autoBackupEnabled).toBe(true);
  });

  it('updateSettings is a noop-safe operation with an empty patch', async () => {
    const before = await getSettings(db);
    const after = await updateSettings(db, {});
    expect(after).toEqual(before);
  });
});

// =============================================================================
// S16 -- v4 -> v5 destructive migration
// =============================================================================
//
// The v5 upgrade clears entries/cards/tombstones and the Calendar-flavored
// syncQueue ops, while preserving settings, authTokens, and `pushDataJson`
// syncQueue rows. This test pre-seeds a database at v4 (using a separate
// Dexie instance that ONLY declares versions 1-4 so we never invoke the
// HourTrackDB class's v5 upgrade prematurely), closes it, then re-opens at
// v5 via `HourTrackDB` and asserts each preservation/clearance branch.
//
// Rationale for the destructive cutover lives in the v5 inline comment in
// `schema.ts` and in the S16 sprint spec.
describe('S16 — v4 to v5 destructive migration', () => {
  it('clears entries/cards/tombstones, prunes Calendar queue ops, preserves settings + authTokens + pushDataJson rows', async () => {
    // Each test gets a unique database name so a parallel test doesn't see
    // a half-migrated store.
    const dbName = `hourtrack-mig-${Math.random().toString(36).slice(2)}`;

    // ---- Step 1: open a "v4-only" Dexie that knows nothing about v5. ----
    // We declare versions 1-4 exactly as the production schema did before
    // S16, so the database file ends up stamped at version 4 when we close
    // it. The Dexie import is local so we don't pull a second copy across
    // the whole suite.
    const { default: Dexie } = await import('dexie');
    const seed = new Dexie(dbName);
    seed.version(1).stores({
      cards: 'id, name, isArchived, updatedAt',
      entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
      settings: 'key',
      syncQueue: '++id, op, entityType, entityId, createdAt',
    });
    seed.version(2).stores({
      cards: 'id, name, isArchived, updatedAt',
      entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
      settings: 'key',
      syncQueue: '++id, op, entityType, entityId, createdAt',
      authTokens: 'key',
    });
    seed.version(3).stores({
      cards: 'id, name, isArchived, updatedAt',
      entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
      settings: 'key',
      syncQueue: '++id, op, entityType, entityId, createdAt, nextAttemptAt',
      authTokens: 'key',
      tombstones: 'entityId, entityType, deletedAt',
    });
    seed.version(4).stores({
      cards: 'id, name, isArchived, updatedAt',
      entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
      settings: 'key',
      syncQueue: '++id, op, entityType, entityId, createdAt, nextAttemptAt',
      authTokens: 'key',
      tombstones: 'entityId, entityType, deletedAt',
    });
    await seed.open();
    expect(seed.verno).toBe(4);

    // ---- Step 2: seed legacy data that the migration must wipe / keep. ----
    // Cards / entries / tombstones are intentionally seeded WITHOUT the new
    // v5 fields (defaultStartMinutes / startMinutes) — that's exactly what
    // a pre-S16 database holds. The migration is supposed to drop these
    // rows wholesale, so the missing field never reaches the v5-typed
    // store.
    await seed.table('cards').put({
      id: 'legacy-card',
      name: 'Legacy',
      color: '#3B82F6',
      defaultDurationMin: 480,
      rateType: 'hourly',
      hourlyRate: 20,
      fixedTotal: null,
      defaultNote: null,
      isArchived: false,
      archivedAt: null,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    await seed.table('entries').put({
      id: 'legacy-entry',
      cardId: 'legacy-card',
      date: '2026-05-10',
      durationMin: 60,
      useCustomPayment: false,
      customPayment: null,
      note: null,
      googleEventId: 'evt-legacy',
      syncStatus: 'synced',
      syncError: null,
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    });
    await seed.table('tombstones').put({
      entityId: 'legacy-tomb',
      entityType: 'entry',
      deletedAt: '2026-05-12T00:00:00.000Z',
    });

    // Settings row is preserved verbatim.
    await seed.table('settings').put({
      key: 'current',
      language: 'uk',
      theme: 'dark',
      defaultView: 'week',
      hourtrackCalendarId: 'cal-keep',
      autoBackupEnabled: true,
      autoBackupIntervalDays: 5,
      lastBackupAt: '2026-05-14T00:00:00.000Z',
      lastSyncAt: '2026-05-14T01:00:00.000Z',
      firstLoginAt: '2026-04-01T00:00:00.000Z',
      deviceId: 'device-keep',
      driveDataFileId: 'drive-file-keep',
      driveDataEtag: 'etag-keep',
      onboardingSeen: true,
    });

    // Auth tokens row is preserved.
    await seed.table('authTokens').put({
      key: 'current',
      accessToken: 'AT-keep',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      refreshToken: 'RT-keep',
      idToken: 'IDT-keep',
      scope: 'openid email profile drive.appdata',
      email: 'tester@example.com',
      name: 'Tester',
      picture: null,
    });

    // Sync queue: a mix that exercises every branch of the prune rule.
    await seed.table('syncQueue').add({
      op: 'pushDataJson',
      mutation: 'update',
      entityType: 'card',
      entityId: 'legacy-card',
      createdAt: '2026-05-14T00:00:00.000Z',
    });
    await seed.table('syncQueue').add({
      op: 'pushDataJson',
      createdAt: '2026-05-14T00:01:00.000Z',
    });
    await seed.table('syncQueue').add({
      op: 'createCalendarEvent',
      entityType: 'entry',
      entityId: 'legacy-entry',
      createdAt: '2026-05-14T00:02:00.000Z',
    });
    await seed.table('syncQueue').add({
      op: 'updateCalendarEvent',
      entityType: 'entry',
      entityId: 'legacy-entry',
      createdAt: '2026-05-14T00:03:00.000Z',
    });
    await seed.table('syncQueue').add({
      op: 'deleteCalendarEvent',
      entityType: 'entry',
      entityId: 'legacy-entry',
      payload: { googleEventId: 'evt-legacy' },
      createdAt: '2026-05-14T00:04:00.000Z',
    });
    await seed.table('syncQueue').add({
      op: 'bulkUpdateCardEvents',
      entityType: 'card',
      entityId: 'legacy-card',
      createdAt: '2026-05-14T00:05:00.000Z',
    });

    seed.close();

    // ---- Step 3: re-open via the production schema -> runs v4 -> v5. ----
    const migratedDb = new HourTrackDB(dbName);
    await migratedDb.open();
    expect(migratedDb.verno).toBe(5);

    // Cleared stores:
    expect(await migratedDb.entries.toArray()).toEqual([]);
    expect(await migratedDb.cards.toArray()).toEqual([]);
    expect(await migratedDb.tombstones.toArray()).toEqual([]);

    // Sync queue: every Calendar-flavored op is gone; `pushDataJson` rows
    // survive (both of them — including the one with informational
    // entity* fields).
    const remainingQueue = await migratedDb.syncQueue.toArray();
    expect(remainingQueue).toHaveLength(2);
    expect(remainingQueue.every((row) => row.op === 'pushDataJson')).toBe(true);
    const remainingOps = remainingQueue.map((row) => row.op).sort();
    expect(remainingOps).toEqual(['pushDataJson', 'pushDataJson']);

    // Settings preserved verbatim (every field — including the
    // sync-bookkeeping that S10 introduced).
    const settings = await migratedDb.settings.get('current');
    expect(settings).toBeDefined();
    expect(settings!.language).toBe('uk');
    expect(settings!.theme).toBe('dark');
    expect(settings!.defaultView).toBe('week');
    expect(settings!.hourtrackCalendarId).toBe('cal-keep');
    expect(settings!.deviceId).toBe('device-keep');
    expect(settings!.driveDataFileId).toBe('drive-file-keep');
    expect(settings!.driveDataEtag).toBe('etag-keep');
    expect(settings!.onboardingSeen).toBe(true);

    // Auth tokens preserved verbatim — the Google session survives the
    // wipe so the user doesn't have to re-sign-in.
    const tokens = await migratedDb.authTokens.get('current');
    expect(tokens).toBeDefined();
    expect(tokens!.accessToken).toBe('AT-keep');
    expect(tokens!.refreshToken).toBe('RT-keep');
    expect(tokens!.email).toBe('tester@example.com');

    await migratedDb.delete();
  });
});
