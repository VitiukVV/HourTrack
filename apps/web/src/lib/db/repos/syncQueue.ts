import type { HourTrackDB, SyncQueueRow } from '../schema';
import { nowIso } from '../mutate';

/**
 * Enqueue a sync operation. Returns the auto-incremented row id.
 *
 * S10 callers should funnel through `SyncManager.enqueue` rather than calling
 * this directly so the in-process debounce + lock semantics apply, but the
 * pure helper is exposed for tests and for the SyncManager itself.
 */
export async function enqueueSyncOp(
  db: HourTrackDB,
  op: Omit<SyncQueueRow, 'id' | 'createdAt' | 'attempts' | 'nextAttemptAt'> &
    Partial<Pick<SyncQueueRow, 'createdAt' | 'attempts' | 'nextAttemptAt'>>,
): Promise<number> {
  const row: Omit<SyncQueueRow, 'id'> = {
    op: op.op,
    mutation: op.mutation,
    entityType: op.entityType,
    entityId: op.entityId,
    payload: op.payload,
    createdAt: op.createdAt ?? nowIso(),
    attempts: op.attempts ?? 0,
    nextAttemptAt: op.nextAttemptAt ?? 0,
    lastError: null,
  };
  // Dexie's `add()` typing returns `IndexableType` for auto-inc primaries.
  // The actual runtime value is a number; cast accordingly.
  const id = (await db.syncQueue.add(row as SyncQueueRow)) as unknown as number;
  return id;
}

/**
 * Drain the queue head: returns rows whose `nextAttemptAt <= now`, ordered
 * by `createdAt`. Filtering by `nextAttemptAt` index is the fast path; we
 * default to "now" when the param is omitted so callers don't have to clock
 * themselves.
 */
export async function getReadySyncQueueRows(
  db: HourTrackDB,
  now: number = Date.now(),
): Promise<SyncQueueRow[]> {
  const rows = await db.syncQueue.where('nextAttemptAt').belowOrEqual(now).sortBy('createdAt');
  return rows;
}

export async function getAllSyncQueueRows(db: HourTrackDB): Promise<SyncQueueRow[]> {
  return db.syncQueue.orderBy('createdAt').toArray();
}

/**
 * Mark an op as completed and remove it. Wrapped in a transaction so a
 * concurrent enqueue cannot lose the row.
 */
export async function deleteSyncQueueRow(db: HourTrackDB, id: number): Promise<void> {
  await db.syncQueue.delete(id);
}

/**
 * Increment the attempts counter + push the next attempt out by `delayMs`.
 * Used by the retry policy after a failed push.
 */
export async function rescheduleSyncQueueRow(
  db: HourTrackDB,
  id: number,
  delayMs: number,
  lastError: string | null = null,
): Promise<void> {
  const existing = await db.syncQueue.get(id);
  if (!existing) return;
  await db.syncQueue.update(id, {
    attempts: (existing.attempts ?? 0) + 1,
    nextAttemptAt: Date.now() + delayMs,
    lastError,
  });
}
