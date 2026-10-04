import type { Table } from 'dexie';

import type { TombstoneEntityType } from '@hourtrack/shared-types';

import type { HourTrackDB, TombstoneRow } from './schema';

/**
 * The write rules every repository shares. Every write stamps `updatedAt`
 * (the Drive LWW merge compares it); every delete of a synced row leaves a
 * tombstone, or other devices would treat the row's absence as "not yet
 * synced" and re-add their copy.
 */

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Atomic get → merge → stamp `updatedAt` → validate → put, in ONE `rw`
 * transaction (S31, UR-31-4): two concurrent read-modify-writes of the same
 * row — a Calendar sync stamp and a user edit, cross-tab or during a flush —
 * must both land instead of the second clobbering the first.
 *
 * Throws `"<notFound>: <id>"` for a missing row; `validate` sees the merged
 * row and throws to abort the write.
 */
export async function patchRow<T extends { id: string; updatedAt: string }, TInsert>(
  table: Table<T, string, TInsert>,
  id: string,
  patch: Partial<Omit<T, 'id' | 'createdAt'>>,
  notFound: string,
  // Must be synchronous: it runs inside the transaction and is not awaited.
  validate?: (next: T) => void,
): Promise<T> {
  return table.db.transaction('rw', table, async () => {
    const existing = await table.get(id);
    if (!existing) throw new Error(`${notFound}: ${id}`);
    const next: T = { ...existing, ...patch, id, updatedAt: nowIso() };
    validate?.(next);
    // A full row is a valid insert shape; Dexie's generics can't see that for a generic T.
    await table.put(next as unknown as TInsert);
    return next;
  });
}

/**
 * Delete a row and record its tombstone in one `rw` transaction. Idempotent:
 * a missing row returns `null` and writes nothing. Returns the deleted row so
 * the caller can enqueue follow-up work (e.g. deleting its Calendar event).
 */
export async function deleteWithTombstone<T extends { id: string }, TInsert>(
  db: HourTrackDB,
  table: Table<T, string, TInsert>,
  entityType: TombstoneEntityType,
  id: string,
): Promise<T | null> {
  return db.transaction('rw', table, db.tombstones, async () => {
    const existing = await table.get(id);
    if (!existing) return null;
    await table.delete(id);
    const tombstone: TombstoneRow = { entityId: id, entityType, deletedAt: nowIso() };
    await db.tombstones.put(tombstone);
    return existing;
  });
}
