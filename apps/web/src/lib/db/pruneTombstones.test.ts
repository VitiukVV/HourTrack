import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { TOMBSTONE_TTL_DAYS } from '@/lib/sync/retention';

import { pruneOldTombstones } from './queries';
import { HourTrackDB } from './schema';

/**
 * Spec 004 (FR-004) — ONE pruner, ONE window: boot (main.tsx) and the
 * SyncManager both call `pruneOldTombstones(db)`, whose default is the same
 * `TOMBSTONE_TTL_DAYS` the merge applies. The SyncManager used to pass a
 * hard-coded 30 while the merge kept 180.
 */
const prune = (now: Date) => pruneOldTombstones(db, undefined, now);

let db: HourTrackDB;

const NOW = new Date('2026-08-30T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-prune-${Math.random().toString(36).slice(2)}`);
  await db.open();
});

describe('pruneOldTombstones — default retention window', () => {
  it('drops only the tombstones past the retention window', async () => {
    await db.tombstones.bulkPut([
      { entityId: 'fresh', entityType: 'entry', deletedAt: daysAgo(1) },
      { entityId: 'edge', entityType: 'entry', deletedAt: daysAgo(TOMBSTONE_TTL_DAYS - 1) },
      { entityId: 'stale', entityType: 'card', deletedAt: daysAgo(TOMBSTONE_TTL_DAYS + 1) },
    ]);

    const removed = await prune(NOW);

    expect(removed).toBe(1);
    const left = (await db.tombstones.toArray()).map((t) => t.entityId).sort();
    expect(left).toEqual(['edge', 'fresh']);
  });

  it('is a no-op on an empty store', async () => {
    expect(await prune(NOW)).toBe(0);
  });

  it('keeps a deletion that is younger than the window by a whisker', async () => {
    // The window is the ONLY thing standing between a long-offline device and
    // a resurrected row, so the boundary is deliberately inclusive.
    await db.tombstones.put({
      entityId: 'boundary',
      entityType: 'payment',
      deletedAt: daysAgo(TOMBSTONE_TTL_DAYS),
    });
    await prune(NOW);
    expect(await db.tombstones.get('boundary')).toBeDefined();
  });
});
