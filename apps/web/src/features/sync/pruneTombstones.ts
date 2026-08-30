import type { HourTrackDB } from '@/lib/db/schema';

import { TOMBSTONE_TTL_MS } from './retention';

/**
 * Drop tombstones older than the retention window from LOCAL storage.
 *
 * `lwwMerge` already keeps expired tombstones out of the merged snapshot, so
 * they never reach Drive — but nothing ever removed them from Dexie, so the
 * store grew by one row per deletion for the life of the install and every
 * snapshot build re-read them.
 *
 * Returns how many rows were removed (used by the test; the caller ignores it).
 */
export async function pruneTombstones(db: HourTrackDB, now: Date = new Date()): Promise<number> {
  const cutoffIso = new Date(now.getTime() - TOMBSTONE_TTL_MS).toISOString();
  const expired = await db.tombstones.where('deletedAt').below(cutoffIso).primaryKeys();
  if (expired.length === 0) return 0;
  await db.tombstones.bulkDelete(expired);
  return expired.length;
}
