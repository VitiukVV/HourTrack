import type { Entry } from '@hourtrack/shared-types';
import { compareEntriesForDisplay } from '@hourtrack/shared-utils';

import type { HourTrackDB } from '../schema';
import { deleteWithTombstone, nowIso, patchRow } from '../mutate';

/**
 * Inclusive range `[start, end]` on YYYY-MM-DD strings. Returns entries in
 * `compareEntriesForDisplay` order (S32): date, then start time, then the
 * longer entry first, then creation order, then id.
 */
export async function getEntriesByDateRange(
  db: HourTrackDB,
  start: string,
  end: string,
): Promise<Entry[]> {
  const rows = await db.entries.where('date').between(start, end, true, true).toArray();
  rows.sort(compareEntriesForDisplay);
  return rows;
}

/**
 * Returns ALL entries across all dates. Used by the S10 snapshot builder
 * (replaces the prior 1970→2200 range hack flagged in the S08 journal). The
 * Settings CSV export that previously consumed this was removed in V2
 * cleanup per V2_FEATURE_PLAN decision #3.
 *
 * Sorted by `compareEntriesForDisplay` (S32) so two consecutive calls produce
 * identical orderings — important for tests that snapshot the result, and so
 * the snapshot builder doesn't carry an ordering of its own.
 */
export async function getAllEntries(db: HourTrackDB): Promise<Entry[]> {
  const rows = await db.entries.toArray();
  rows.sort(compareEntriesForDisplay);
  return rows;
}

/**
 * All entries on one calendar day, in `compareEntriesForDisplay` order (S32).
 *
 * The sort is load-bearing: before S32 this returned Dexie's index-walk order,
 * which meant the DayPage list could disagree with the calendar about the same
 * day even before the user edited anything.
 */
export async function getEntriesByDate(db: HourTrackDB, date: string): Promise<Entry[]> {
  const rows = await db.entries.where('date').equals(date).toArray();
  rows.sort(compareEntriesForDisplay);
  return rows;
}

/**
 * Single-entry lookup by primary key. Used by the S17 inline-edit modal,
 * which needs to populate the form from a known `entryId` without paying
 * the cost of a range query. Returns `undefined` if the entry was deleted
 * out from under the caller (e.g. another tab tombstone'd it mid-edit).
 */
export async function getEntryById(db: HourTrackDB, id: string): Promise<Entry | undefined> {
  return db.entries.get(id);
}

export async function getEntriesByCardId(db: HourTrackDB, cardId: string): Promise<Entry[]> {
  return db.entries.where('cardId').equals(cardId).toArray();
}

/**
 * Fast lookup for "all entries belonging to `cardId` on `date`" via the
 * compound `[cardId+date]` index (declared in `schema.ts`). Used by the
 * S05 active-card day-click flow to decide whether a click creates a new
 * entry or deletes the existing one, and by the S06 DayPage to surface
 * card-specific multi-session entries.
 *
 * Returns `[]` when no entries match (never `undefined`).
 */
export async function getEntriesByCardAndDate(
  db: HourTrackDB,
  cardId: string,
  date: string,
): Promise<Entry[]> {
  return db.entries.where('[cardId+date]').equals([cardId, date]).toArray();
}

export async function createEntry(
  db: HourTrackDB,
  input: Omit<Entry, 'createdAt' | 'updatedAt'>,
): Promise<Entry> {
  const now = nowIso();
  const entry: Entry = { ...input, createdAt: now, updatedAt: now };
  await db.entries.add(entry);
  return entry;
}

export async function updateEntry(
  db: HourTrackDB,
  id: string,
  patch: Partial<Omit<Entry, 'id' | 'createdAt'>>,
): Promise<Entry> {
  // S31 (UR-31-4): atomic get→merge→put — a Calendar sync stamp
  // (googleEventId/syncStatus) and a concurrent user edit can't clobber each
  // other, the classic "lost googleEventId → orphaned event".
  return patchRow(db.entries, id, patch, 'updateEntry: entry not found');
}

/**
 * Delete an entry and record a tombstone. The tombstone is what propagates
 * the delete to other devices via the next Drive snapshot — without it
 * remote devices would treat the entry's absence as "not yet synced" and
 * re-add it from their own copy.
 *
 * Returns the deleted entry's metadata so the calling hook can enqueue the
 * matching `deleteCalendarEvent` op without a separate Dexie read. Returns
 * `null` if the entry didn't exist (delete is idempotent).
 */
export async function deleteEntry(
  db: HourTrackDB,
  id: string,
): Promise<Pick<Entry, 'id' | 'cardId' | 'date' | 'googleEventId'> | null> {
  const existing = await deleteWithTombstone(db, db.entries, 'entry', id);
  if (!existing) return null;
  return {
    id: existing.id,
    cardId: existing.cardId,
    date: existing.date,
    googleEventId: existing.googleEventId,
  };
}

/**
 * Settings → disconnect Google Calendar: reset every entry's Calendar-sync
 * fields so a reconnect (possibly to a different calendar) re-syncs from
 * scratch. Remote events are NOT deleted — the locked safety decision.
 *
 * Deliberately no `updatedAt` stamp: these are this device's link to its
 * calendar, not a user edit, and must not win an LWW merge against a real
 * edit made elsewhere. Returns how many entries changed.
 */
export async function resetCalendarSyncFields(db: HourTrackDB): Promise<number> {
  return db.transaction('rw', db.entries, () =>
    db.entries
      .filter((e) => e.googleEventId !== null || e.syncStatus !== 'pending' || e.syncError !== null)
      .modify({ googleEventId: null, syncStatus: 'pending', syncError: null }),
  );
}
