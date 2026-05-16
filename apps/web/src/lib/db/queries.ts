import type {
  Card,
  Entry,
  Language,
  Settings,
  Tombstone,
  TombstoneEntityType,
} from '@hourtrack/shared-types';

import { isValidCardColor } from '@/lib/colors';

import type { HourTrackDB, SettingsRow, SyncQueueRow, TombstoneRow } from './schema';

/**
 * Pure Dexie query layer. Every write stamps `updatedAt` via `nowIso()`;
 * every create also stamps `createdAt`. UI/feature code MUST go through
 * these helpers rather than touching `db.<table>` directly so the timestamp
 * contract (used by Drive LWW merge in S10) stays invariant.
 */

const SETTINGS_KEY = 'current' as const;
const SUPPORTED_LANGUAGES = ['uk', 'en', 'es'] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function detectLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en';
  const tag = (navigator.language || 'en').toLowerCase();
  const base = tag.split('-')[0] as string | undefined;
  if (!base) return 'en';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base) ? (base as Language) : 'en';
}

/** Default Settings row applied the first time the app opens on a device. */
export function defaultSettings(): Settings {
  return {
    language: detectLanguage(),
    theme: 'system',
    defaultView: 'month',
    hourtrackCalendarId: null,
    autoBackupEnabled: true,
    autoBackupIntervalDays: 3,
    lastBackupAt: null,
    lastSyncAt: null,
    firstLoginAt: null,
    deviceId: null,
    driveDataFileId: null,
    driveDataEtag: null,
    onboardingSeen: false,
  };
}

/**
 * Idempotent: seeds the single `settings` row if it doesn't exist yet. Safe
 * to call on every app boot.
 */
export async function initDB(db: HourTrackDB): Promise<void> {
  const existing = await db.settings.get(SETTINGS_KEY);
  if (existing) return;
  const row: SettingsRow = { key: SETTINGS_KEY, ...defaultSettings() };
  await db.settings.put(row);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * Defensive runtime check applied by `createCard` / `updateCard` per the S03
 * followups flagged in the S02 pipeline journal:
 *
 *   1. `color` must be one of the 12 sanctioned palette hexes
 *      (`CARD_COLORS`). Off-palette hexes would otherwise sneak in via a
 *      future Drive-snapshot restore (S11) or a malformed external write.
 *   2. Rate-type invariants:
 *      - `rateType === 'hourly'`  => hourlyRate non-null, fixedTotal === null, monthlyTotal === null
 *      - `rateType === 'fixed'`   => fixedTotal non-null, hourlyRate === null, monthlyTotal === null
 *      - `rateType === 'monthly'` => monthlyTotal non-null, hourlyRate === null, fixedTotal === null (S21)
 *
 * The zod form schema in `@/features/cards/cardSchema.ts` enforces the same
 * rules upstream so users see friendly i18n'd errors before this check fires.
 * This helper is the last line of defense.
 *
 * Throws `Error` with a concrete message (always includes the offending field
 * name) so the layer that triggered the write can surface a useful diagnostic.
 */
function assertCardShape(card: {
  color: string;
  rateType: Card['rateType'];
  hourlyRate: number | null;
  fixedTotal: number | null;
  monthlyTotal: number | null;
}): void {
  if (!isValidCardColor(card.color)) {
    throw new Error(`Invalid card color "${card.color}": not in CARD_COLORS palette`);
  }
  if (card.rateType === 'hourly') {
    if (card.hourlyRate == null) {
      throw new Error('hourlyRate is required when rateType is "hourly"');
    }
    if (card.fixedTotal != null) {
      throw new Error('fixedTotal must be null when rateType is "hourly"');
    }
    if (card.monthlyTotal != null) {
      throw new Error('monthlyTotal must be null when rateType is "hourly"');
    }
  } else if (card.rateType === 'fixed') {
    if (card.fixedTotal == null) {
      throw new Error('fixedTotal is required when rateType is "fixed"');
    }
    if (card.hourlyRate != null) {
      throw new Error('hourlyRate must be null when rateType is "fixed"');
    }
    if (card.monthlyTotal != null) {
      throw new Error('monthlyTotal must be null when rateType is "fixed"');
    }
  } else {
    // S21: 'monthly' retainer card.
    if (card.monthlyTotal == null) {
      throw new Error('monthlyTotal is required when rateType is "monthly"');
    }
    if (card.hourlyRate != null) {
      throw new Error('hourlyRate must be null when rateType is "monthly"');
    }
    if (card.fixedTotal != null) {
      throw new Error('fixedTotal must be null when rateType is "monthly"');
    }
  }
}

/**
 * Returns all cards. By default archived cards are excluded; pass
 * `includeArchived = true` to include them (e.g. Settings -> Card archive).
 */
export async function getAllCards(db: HourTrackDB, includeArchived = false): Promise<Card[]> {
  if (includeArchived) {
    return db.cards.toArray();
  }
  // Dexie cannot index booleans as keys reliably across all browsers, so
  // filter in memory. `isArchived` is also indexed for tooling but the
  // filter remains the source of truth.
  return db.cards.filter((c) => !c.isArchived).toArray();
}

/**
 * Convenience wrapper for the archive list (Settings page, S08).
 */
export async function getArchivedCards(db: HourTrackDB): Promise<Card[]> {
  return db.cards.filter((c) => c.isArchived).toArray();
}

export async function getCardById(db: HourTrackDB, id: string): Promise<Card | undefined> {
  return db.cards.get(id);
}

export async function createCard(
  db: HourTrackDB,
  input: Omit<Card, 'createdAt' | 'updatedAt'>,
): Promise<Card> {
  assertCardShape(input);
  const now = nowIso();
  const card: Card = { ...input, createdAt: now, updatedAt: now };
  await db.cards.add(card);
  return card;
}

/**
 * Apply a partial patch and stamp a fresh `updatedAt`. Throws if the card
 * does not exist, or if the resulting merged shape violates the card
 * invariants (see `assertCardShape`).
 */
export async function updateCard(
  db: HourTrackDB,
  id: string,
  patch: Partial<Omit<Card, 'id' | 'createdAt'>>,
): Promise<Card> {
  const existing = await db.cards.get(id);
  if (!existing) throw new Error(`updateCard: card not found: ${id}`);
  const next: Card = { ...existing, ...patch, id, updatedAt: nowIso() };
  // Only assert the shape if the patch actually touches invariant-bearing
  // fields. This keeps archive/restore reachable for cleanup even when a
  // legacy or Drive-restored card has a stale shape (e.g. an off-palette
  // color introduced by a future palette change in S11 restore).
  const touchesShape =
    'color' in patch ||
    'rateType' in patch ||
    'hourlyRate' in patch ||
    'fixedTotal' in patch ||
    'monthlyTotal' in patch;
  if (touchesShape) {
    assertCardShape(next);
  }
  await db.cards.put(next);
  return next;
}

export async function archiveCard(db: HourTrackDB, id: string): Promise<Card> {
  // Archive is a SOFT delete -- the card row stays in Dexie with
  // `isArchived = true`. No tombstone is written: the card is still
  // "alive" from a sync perspective and other devices learn about the
  // archive via the row's updated `isArchived` field + bumped
  // `updatedAt`. Restore is its inverse.
  return updateCard(db, id, { isArchived: true, archivedAt: nowIso() });
}

export async function restoreCard(db: HourTrackDB, id: string): Promise<Card> {
  // Restore also clears any stale tombstone for this card id — covers the
  // edge case where the user hard-deleted, then restored the same id from
  // a backup (S11), then immediately restored from archive. Without this
  // call the tombstone in `data.json` would silently re-delete the card
  // on every other device.
  await clearTombstone(db, id);
  return updateCard(db, id, { isArchived: false, archivedAt: null });
}

/**
 * Hard-delete a card AND every entry that references it. Used by the S08
 * Settings "Delete permanently" affordance.
 *
 * Wrapped in a Dexie transaction so the cascade is atomic — either every
 * table is cleaned up or none is touched. Idempotent: deleting a card that
 * doesn't exist is a no-op (mirrors `db.cards.delete`'s own behavior).
 *
 * S10: writes a tombstone for the card AND one per cascaded entry. Other
 * devices learn about the cascade by replaying tombstones during their next
 * Drive snapshot read.
 */
export async function deleteCardPermanently(db: HourTrackDB, id: string): Promise<void> {
  await db.transaction('rw', db.cards, db.entries, db.tombstones, async () => {
    const orphanedEntryIds = await db.entries.where('cardId').equals(id).primaryKeys();
    const deletedAt = nowIso();
    await db.entries.where('cardId').equals(id).delete();
    await db.cards.delete(id);
    // Tombstones for the cascade so remote devices propagate the same
    // delete instead of treating the absence as "not yet synced".
    const tombstoneRows: TombstoneRow[] = [
      { entityId: id, entityType: 'card', deletedAt },
      ...orphanedEntryIds.map(
        (entryId): TombstoneRow => ({
          entityId: String(entryId),
          entityType: 'entry',
          deletedAt,
        }),
      ),
    ];
    if (tombstoneRows.length > 0) {
      await db.tombstones.bulkPut(tombstoneRows);
    }
  });
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/**
 * Inclusive range `[start, end]` on YYYY-MM-DD strings. Returns entries
 * sorted by `date` ascending (and by `createdAt` as a stable tiebreaker
 * when two entries share a date).
 */
export async function getEntriesByDateRange(
  db: HourTrackDB,
  start: string,
  end: string,
): Promise<Entry[]> {
  const rows = await db.entries.where('date').between(start, end, true, true).toArray();
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return rows;
}

/**
 * Returns ALL entries across all dates. Used by the S10 snapshot builder
 * (replaces the prior 1970→2200 range hack flagged in the S08 journal). The
 * Settings CSV export that previously consumed this was removed in V2
 * cleanup per V2_FEATURE_PLAN decision #3.
 *
 * Sorted by `date` ascending with `createdAt` as a stable tiebreaker so two
 * consecutive calls produce identical orderings (important for tests that
 * snapshot the result).
 */
export async function getAllEntries(db: HourTrackDB): Promise<Entry[]> {
  const rows = await db.entries.toArray();
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return rows;
}

export async function getEntriesByDate(db: HourTrackDB, date: string): Promise<Entry[]> {
  return db.entries.where('date').equals(date).toArray();
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
  const existing = await db.entries.get(id);
  if (!existing) throw new Error(`updateEntry: entry not found: ${id}`);
  const next: Entry = { ...existing, ...patch, id, updatedAt: nowIso() };
  await db.entries.put(next);
  return next;
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
  return db.transaction('rw', db.entries, db.tombstones, async () => {
    const existing = await db.entries.get(id);
    if (!existing) return null;
    await db.entries.delete(id);
    const tombstoneRow: TombstoneRow = {
      entityId: id,
      entityType: 'entry',
      deletedAt: nowIso(),
    };
    await db.tombstones.put(tombstoneRow);
    return {
      id: existing.id,
      cardId: existing.cardId,
      date: existing.date,
      googleEventId: existing.googleEventId,
    };
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(db: HourTrackDB): Promise<Settings | null> {
  const row = await db.settings.get(SETTINGS_KEY);
  if (!row) return null;
  // Strip the `key` discriminator before returning the public Settings shape.
  const { key: _key, ...rest } = row;
  return rest;
}

/**
 * Apply a partial patch to the (always single) settings row. The row is
 * created with defaults if it does not yet exist.
 */
export async function updateSettings(db: HourTrackDB, patch: Partial<Settings>): Promise<Settings> {
  const existing = await db.settings.get(SETTINGS_KEY);
  const base: Settings = existing
    ? (() => {
        const { key: _key, ...rest } = existing;
        return rest;
      })()
    : defaultSettings();
  const next: Settings = { ...base, ...patch };
  await db.settings.put({ key: SETTINGS_KEY, ...next });
  return next;
}

// ---------------------------------------------------------------------------
// Sync queue (S10)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tombstones (S10)
// ---------------------------------------------------------------------------

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
 * Drop tombstones older than `keepDays` days (default 30). Returns the number
 * of rows pruned. Called from `SyncManager` after each successful push.
 */
export async function pruneOldTombstones(
  db: HourTrackDB,
  keepDays = 30,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000).toISOString();
  const toDelete = await db.tombstones.where('deletedAt').below(cutoff).primaryKeys();
  if (toDelete.length === 0) return 0;
  await db.tombstones.bulkDelete(toDelete);
  return toDelete.length;
}
