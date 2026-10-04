import type { Tombstone, TombstoneEntityType } from '@hourtrack/shared-types';

import { TOMBSTONE_TTL_DAYS } from '@/lib/sync/retention';

import type { HourTrackDB, TombstoneRow } from '../schema';
import { nowIso } from '../mutate';

/**
 * Record that an entity was deleted. Idempotent on `entityId` — re-deleting
 * the same id overwrites the existing tombstone's timestamp instead of
 * duplicating.
 */
export async function writeTombstone(
  db: HourTrackDB,
  entityType: TombstoneEntityType,
  entityId: string,
  deletedAt: string = nowIso(),
): Promise<Tombstone> {
  const row: TombstoneRow = { entityId, entityType, deletedAt };
  await db.tombstones.put(row);
  return row;
}

export async function getAllTombstones(db: HourTrackDB): Promise<Tombstone[]> {
  return db.tombstones.toArray();
}

/** Remove a tombstone — used when a card is restored from archive. */
export async function clearTombstone(db: HourTrackDB, entityId: string): Promise<void> {
  await db.tombstones.delete(entityId);
}

/**
 * Drop tombstones older than `keepDays` days — by default the same
 * `TOMBSTONE_TTL_DAYS` window the merge applies (the two must agree, see
 * `lib/sync/retention.ts`). Returns the number of rows pruned. Called at boot
 * (`main.tsx`) and by `SyncManager` after each successful push.
 */
export async function pruneOldTombstones(
  db: HourTrackDB,
  keepDays = TOMBSTONE_TTL_DAYS,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000).toISOString();
  const toDelete = await db.tombstones.where('deletedAt').below(cutoff).primaryKeys();
  if (toDelete.length === 0) return 0;
  await db.tombstones.bulkDelete(toDelete);
  return toDelete.length;
}
