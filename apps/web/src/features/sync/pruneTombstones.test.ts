import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { HourTrackDB } from '@/lib/db/schema';

import { pruneTombstones } from './pruneTombstones';
import { TOMBSTONE_TTL_DAYS } from './retention';

let db: HourTrackDB;

const NOW = new Date('2026-08-30T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-prune-${Math.random().toString(36).slice(2)}`);
  await db.open();
});

describe('pruneTombstones', () => {
  it('drops only the tombstones past the retention window', async () => {
    await db.tombstones.bulkPut([
      { entityId: 'fresh', entityType: 'entry', deletedAt: daysAgo(1) },
      { entityId: 'edge', entityType: 'entry', deletedAt: daysAgo(TOMBSTONE_TTL_DAYS - 1) },
      { entityId: 'stale', entityType: 'card', deletedAt: daysAgo(TOMBSTONE_TTL_DAYS + 1) },
    ]);

    const removed = await pruneTombstones(db, NOW);

    expect(removed).toBe(1);
    const left = (await db.tombstones.toArray()).map((t) => t.entityId).sort();
    expect(left).toEqual(['edge', 'fresh']);
  });

  it('is a no-op on an empty store', async () => {
    expect(await pruneTombstones(db, NOW)).toBe(0);
  });

  it('keeps a deletion that is younger than the window by a whisker', async () => {
    // The window is the ONLY thing standing between a long-offline device and
    // a resurrected row, so the boundary is deliberately inclusive.
    await db.tombstones.put({
      entityId: 'boundary',
      entityType: 'payment',
      deletedAt: daysAgo(TOMBSTONE_TTL_DAYS),
    });
    await pruneTombstones(db, NOW);
    expect(await db.tombstones.get('boundary')).toBeDefined();
  });
});
