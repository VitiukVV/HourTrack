import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Card } from '@hourtrack/shared-types';

import { HourTrackDB } from './schema';
import {
  clearTombstone,
  createCard,
  createEntry,
  deleteCardPermanently,
  deleteEntry,
  deleteSyncQueueRow,
  enqueueSyncOp,
  getAllSyncQueueRows,
  getAllTombstones,
  getReadySyncQueueRows,
  initDB,
  pruneOldTombstones,
  rescheduleSyncQueueRow,
  restoreCard,
  writeTombstone,
} from './queries';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-syncq-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

function newCard(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'C',
    color: '#2563EB',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    ...overrides,
  };
}

describe('syncQueue helpers', () => {
  it('enqueueSyncOp persists a row and getReadySyncQueueRows returns it', async () => {
    const id = await enqueueSyncOp(db, {
      op: 'pushDataJson',
      mutation: 'create',
      entityType: 'card',
      entityId: 'abc',
    });
    expect(typeof id).toBe('number');
    const ready = await getReadySyncQueueRows(db);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.op).toBe('pushDataJson');
    expect(ready[0]!.entityId).toBe('abc');
  });

  it('getReadySyncQueueRows respects nextAttemptAt', async () => {
    await enqueueSyncOp(db, { op: 'pushDataJson', nextAttemptAt: Date.now() + 10_000 });
    const ready = await getReadySyncQueueRows(db);
    expect(ready).toHaveLength(0);
    const all = await getAllSyncQueueRows(db);
    expect(all).toHaveLength(1);
  });

  it('rescheduleSyncQueueRow bumps attempts + nextAttemptAt', async () => {
    const id = await enqueueSyncOp(db, { op: 'pushDataJson' });
    await rescheduleSyncQueueRow(db, id, 5_000, 'transient');
    const all = await getAllSyncQueueRows(db);
    const row = all[0]!;
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('transient');
    expect((row.nextAttemptAt ?? 0) - Date.now()).toBeGreaterThan(3_000);
  });

  it('deleteSyncQueueRow removes the row', async () => {
    const id = await enqueueSyncOp(db, { op: 'pushDataJson' });
    await deleteSyncQueueRow(db, id);
    const remaining = await getAllSyncQueueRows(db);
    expect(remaining).toHaveLength(0);
  });
});

describe('tombstone helpers', () => {
  it('writeTombstone is idempotent on entityId — overwrites the existing timestamp', async () => {
    await writeTombstone(db, 'card', 'c1', '2026-05-10T00:00:00.000Z');
    await writeTombstone(db, 'card', 'c1', '2026-05-12T00:00:00.000Z');
    const all = await getAllTombstones(db);
    expect(all).toHaveLength(1);
    expect(all[0]!.deletedAt).toBe('2026-05-12T00:00:00.000Z');
  });

  it('clearTombstone removes the row', async () => {
    await writeTombstone(db, 'entry', 'e1');
    await clearTombstone(db, 'e1');
    expect(await getAllTombstones(db)).toHaveLength(0);
  });

  it('pruneOldTombstones drops rows older than the TTL', async () => {
    const now = new Date('2026-05-15T00:00:00.000Z');
    await writeTombstone(db, 'card', 'old', '2026-03-01T00:00:00.000Z'); // 75 days ago
    await writeTombstone(db, 'card', 'recent', '2026-05-10T00:00:00.000Z');
    const pruned = await pruneOldTombstones(db, 30, now);
    expect(pruned).toBe(1);
    const remaining = await getAllTombstones(db);
    expect(remaining.map((t) => t.entityId)).toEqual(['recent']);
  });
});

describe('cascade tombstones via deleteCardPermanently', () => {
  it('writes a tombstone for the card AND every cascaded entry', async () => {
    const card = await createCard(db, newCard({ name: 'To Delete' }));
    await createEntry(db, {
      id: crypto.randomUUID(),
      cardId: card.id,
      date: '2026-05-14',
      startMinutes: 600,
      durationMin: 240,
      useCustomPayment: false,
      customPayment: null,
      note: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
    });
    await createEntry(db, {
      id: crypto.randomUUID(),
      cardId: card.id,
      date: '2026-05-15',
      startMinutes: 600,
      durationMin: 60,
      useCustomPayment: false,
      customPayment: null,
      note: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
    });

    await deleteCardPermanently(db, card.id);

    const tombs = await getAllTombstones(db);
    expect(tombs).toHaveLength(3);
    expect(tombs.filter((t) => t.entityType === 'card')).toHaveLength(1);
    expect(tombs.filter((t) => t.entityType === 'entry')).toHaveLength(2);
  });

  it('deleteEntry writes a single entry tombstone and returns meta', async () => {
    const card = await createCard(db, newCard());
    const entry = await createEntry(db, {
      id: crypto.randomUUID(),
      cardId: card.id,
      date: '2026-05-14',
      startMinutes: 600,
      durationMin: 240,
      useCustomPayment: false,
      customPayment: null,
      note: null,
      googleEventId: 'gcal-evt-1',
      syncStatus: 'synced',
      syncError: null,
    });
    const meta = await deleteEntry(db, entry.id);
    expect(meta?.id).toBe(entry.id);
    expect(meta?.googleEventId).toBe('gcal-evt-1');
    expect(meta?.cardId).toBe(card.id);
    expect(meta?.date).toBe('2026-05-14');
    const tombs = await getAllTombstones(db);
    expect(tombs.map((t) => t.entityId)).toEqual([entry.id]);
  });

  it('deleteEntry returns null for an unknown id', async () => {
    const result = await deleteEntry(db, 'never-existed');
    expect(result).toBeNull();
  });

  it('restoreCard clears any stale tombstone with the same id', async () => {
    const card = await createCard(
      db,
      newCard({ isArchived: true, archivedAt: new Date().toISOString() }),
    );
    await writeTombstone(db, 'card', card.id);
    expect(await getAllTombstones(db)).toHaveLength(1);
    await restoreCard(db, card.id);
    expect(await getAllTombstones(db)).toHaveLength(0);
  });
});
