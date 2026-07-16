import type { EntityTable } from 'dexie';

import type { DriveSnapshot, Settings, Tombstone } from '@hourtrack/shared-types';

import {
  db as defaultDb,
  getAllCards,
  getAllEntries,
  getAllPayments,
  getAllReminders,
  getAllTombstones,
  getSettings,
  type HourTrackDB,
} from '@/lib/db';
import { getOrCreateDeviceId } from '@/lib/sync/deviceId';
import { defaultSettings } from '@/lib/db/queries';

/**
 * Snapshot build / apply helpers. Pure-ish: they read/write Dexie but take
 * no Drive dependency at all. SyncManager composes these with the Drive
 * client + LWW merge.
 *
 * `buildSnapshot` produces the on-disk shape that becomes `data.json`. It
 * includes:
 *   - every card (active AND archived)
 *   - every entry
 *   - the Settings row (single-row store)
 *   - every payment (S27 — the "received" side of the ledger)
 *   - every reminder (S28 — dated in-app + Calendar reminders)
 *   - the active tombstones (`pruneOldTombstones` is the SyncManager's job;
 *     buildSnapshot doesn't prune)
 *   - schemaVersion 5 (bumped in S28 -- adds the reminders store. S27 shipped
 *     v4 for payments; S21 shipped v3 for Card.monthlyTotal + 'monthly'
 *     rateType; pre-S28 builds wrote v2/v3/v4; restore handles all via the
 *     in-band backfill in `validateSnapshot`.)
 *   - this device's id (generated on first call if missing)
 *   - `exportedAt` = now-iso
 *
 * `applySnapshot` has two modes (S29):
 *
 *   - `'replace'` (default) — clear-and-rewrite. Used by the DESTRUCTIVE
 *     restore flow (`features/backup/restoreFlow.ts`), where the user has
 *     explicitly chosen to overwrite local data with a chosen backup. Local
 *     rows absent from the snapshot are wiped.
 *
 *   - `'merge'` — row-wise Last-Write-Wins apply inside the same rw
 *     transaction. Used by the SYNC pull paths (`SyncManager` 412 merge +
 *     `bootstrap`). For each row in the (already `lwwMerge`d) snapshot it
 *     writes only if the row wins LWW against the LIVE local row; it deletes
 *     a live row only when a winning tombstone covers it. A local row written
 *     AFTER the snapshot was built (newer `updatedAt`, or an id absent from
 *     both the merged rows and the tombstones) SURVIVES untouched. This
 *     closes the S29 Blocker #1 data-loss window where the old
 *     `clear()`+`bulkPut(merged)` destroyed an entry created/edited mid-flush.
 *
 * The `'merge'` mode is the S29 fix; `'replace'` preserves the intentional
 * "wipe and restore from this exact backup" semantics the restore feature
 * depends on.
 */

export interface BuildSnapshotOptions {
  now?: Date;
}

export async function buildSnapshot(
  database: HourTrackDB = defaultDb,
  options: BuildSnapshotOptions = {},
): Promise<DriveSnapshot> {
  const now = options.now ?? new Date();
  const [cards, entries, payments, reminders, settings, tombstones, deviceId] = await Promise.all([
    getAllCards(database, true),
    getAllEntries(database),
    getAllPayments(database),
    getAllReminders(database),
    getSettings(database),
    getAllTombstones(database),
    getOrCreateDeviceId(database),
  ]);

  // Strip device-local bookkeeping that has no business in a cross-device
  // snapshot. Keep firstLoginAt / lastSyncAt / lastBackupAt — those ARE
  // user-meaningful and should propagate. The merge logic handles them.
  const safeSettings: Settings = settings ?? defaultSettings();
  return {
    schemaVersion: 5,
    exportedAt: now.toISOString(),
    deviceId,
    settings: safeSettings,
    cards,
    entries,
    payments,
    reminders,
    tombstones,
  };
}

/**
 * Replace the local Dexie state with `snapshot`. Wrapped in a single rw
 * transaction so a partial apply never corrupts the local cache.
 *
 * `Settings.deviceId`, `Settings.driveDataFileId`, `Settings.driveDataEtag`
 * are PRESERVED from the existing local row — they're device-local
 * bookkeeping that must NOT be overwritten by a sibling device's snapshot.
 *
 * Returns the count of (cards, entries, tombstones) applied for observability.
 */
export interface ApplySnapshotResult {
  cards: number;
  entries: number;
  payments: number;
  reminders: number;
  tombstones: number;
}

export type ApplyMode = 'replace' | 'merge';

export interface ApplySnapshotOptions {
  /**
   * `'replace'` (default) = destructive clear-and-rewrite (restore flow).
   * `'merge'` = row-wise LWW apply that preserves newer local rows (S29 sync
   * pull fix). See the module doc-comment above for the rationale.
   */
  mode?: ApplyMode;
}

/** A tombstone map (entityId → tombstone) for O(1) suppression lookups. */
type TombstoneMap = Map<string, { entityId: string; deletedAt: string }>;

/**
 * Row-wise LWW apply for one synced store. Writes a merged row only when it
 * wins LWW against the live row (newer `updatedAt`; ties keep local), and
 * deletes a live row only when a winning tombstone (`deletedAt > updatedAt`)
 * covers it. A live row absent from `rows` and not covered by a winning
 * tombstone is left untouched — that is the mid-flush write we must not lose.
 */
async function mergeRowsIntoTable<T extends { id: string; updatedAt: string }>(
  table: EntityTable<T, 'id'>,
  rows: T[],
  tombstoneByEntityId: TombstoneMap,
): Promise<void> {
  const live = new Map((await table.toArray()).map((r) => [r.id, r] as const));

  const puts: T[] = [];
  for (const row of rows) {
    const tomb = tombstoneByEntityId.get(row.id);
    // The row is already the `lwwMerge` result, so a winning tombstone should
    // have suppressed it upstream — guard anyway so a direct call can't
    // resurrect a deleted id.
    if (tomb && tomb.deletedAt > row.updatedAt) continue;
    const cur = live.get(row.id);
    if (!cur || row.updatedAt > cur.updatedAt) {
      puts.push(row);
    }
    // else: live row is newer or a tie → keep it (mid-flush write survives).
  }

  const deletes: string[] = [];
  for (const [id, cur] of live) {
    const tomb = tombstoneByEntityId.get(id);
    // Delete a live row only when a tombstone strictly newer than the live
    // row covers it. A locally re-created row (newer than the tombstone)
    // survives — same convention as `lwwMerge.mergeRows`.
    if (tomb && tomb.deletedAt > cur.updatedAt) {
      deletes.push(id);
    }
  }

  if (puts.length > 0) await table.bulkPut(puts);
  // `id` is `string` (T extends `{ id: string }`), but inside this generic the
  // key type `IDType<T,'id'>` is opaque to TS — cast the delete keys.
  if (deletes.length > 0) await (table.bulkDelete as (keys: string[]) => Promise<void>)(deletes);
}

/**
 * Union the snapshot tombstones into the local tombstone store, keeping the
 * larger `deletedAt` per entity. Never clears — a mid-flush LOCAL delete
 * (tombstone written after the snapshot was built) must survive the apply.
 */
async function mergeTombstonesIntoTable(
  table: EntityTable<Tombstone, 'entityId'>,
  incoming: Tombstone[],
): Promise<void> {
  if (incoming.length === 0) return;
  const live = new Map((await table.toArray()).map((t) => [t.entityId, t] as const));
  const puts: Tombstone[] = [];
  for (const t of incoming) {
    const cur = live.get(t.entityId);
    if (!cur || t.deletedAt > cur.deletedAt) puts.push(t);
  }
  if (puts.length > 0) await table.bulkPut(puts);
}

export async function applySnapshot(
  snapshot: DriveSnapshot,
  database: HourTrackDB = defaultDb,
  options: ApplySnapshotOptions = {},
): Promise<ApplySnapshotResult> {
  const mode: ApplyMode = options.mode ?? 'replace';
  return database.transaction(
    'rw',
    [
      database.cards,
      database.entries,
      database.payments,
      database.reminders,
      database.tombstones,
      database.settings,
    ],
    async () => {
      // S27: payments ride the snapshot. Older (v2/v3) snapshots omit the
      // field — `validateSnapshot` backfills `[]`, but guard here too so a
      // direct `applySnapshot` on a legacy shape doesn't throw.
      const payments = snapshot.payments ?? [];
      // S28: reminders ride the snapshot. Older (v2/v3/v4) snapshots omit it.
      const reminders = snapshot.reminders ?? [];
      const tombstones = snapshot.tombstones ?? [];

      if (mode === 'replace') {
        // Destructive restore: wipe + rewrite each store. bulkPut is
        // idempotent on conflicting keys.
        await database.cards.clear();
        if (snapshot.cards.length > 0) await database.cards.bulkPut(snapshot.cards);
        await database.entries.clear();
        if (snapshot.entries.length > 0) await database.entries.bulkPut(snapshot.entries);
        await database.payments.clear();
        if (payments.length > 0) await database.payments.bulkPut(payments);
        await database.reminders.clear();
        if (reminders.length > 0) await database.reminders.bulkPut(reminders);
        await database.tombstones.clear();
        if (tombstones.length > 0) await database.tombstones.bulkPut(tombstones);
      } else {
        // S29 sync pull: row-wise LWW apply — NO clear(). Preserves any local
        // row written after the snapshot was built.
        const tombstoneByEntityId: TombstoneMap = new Map(tombstones.map((t) => [t.entityId, t]));
        await mergeRowsIntoTable(database.cards, snapshot.cards, tombstoneByEntityId);
        await mergeRowsIntoTable(database.entries, snapshot.entries, tombstoneByEntityId);
        await mergeRowsIntoTable(database.payments, payments, tombstoneByEntityId);
        await mergeRowsIntoTable(database.reminders, reminders, tombstoneByEntityId);
        await mergeTombstonesIntoTable(database.tombstones, tombstones);
      }

      // Merge Settings with care: keep local device bookkeeping.
      const existing = await database.settings.get('current');
      const existingPublic: Settings = existing
        ? (() => {
            const { key: _k, ...rest } = existing;
            return rest;
          })()
        : defaultSettings();

      // S29: in `merge` mode a settings preference change made on THIS device
      // after the snapshot was built must not be reverted by an older inbound
      // snapshot. Compare `settingsUpdatedAt` (missing = epoch): keep the
      // local preference fields when they are strictly newer than the
      // snapshot's. `replace` mode always takes the snapshot prefs (the user
      // asked to restore this exact backup).
      const snapStamp = snapshot.settings.settingsUpdatedAt ?? '';
      const localStamp = existingPublic.settingsUpdatedAt ?? '';
      const keepLocalPrefs = mode === 'merge' && localStamp > snapStamp;
      const prefs: Settings = keepLocalPrefs ? existingPublic : snapshot.settings;

      const merged: Settings = {
        ...prefs,
        // Device-local fields kept from the existing row.
        deviceId: existingPublic.deviceId,
        driveDataFileId: existingPublic.driveDataFileId,
        driveDataEtag: existingPublic.driveDataEtag,
        // S13: pre-S13 snapshots predate `onboardingSeen`. If the inbound
        // snapshot omitted the field, prefer the LOCAL value so a user who
        // already dismissed the tour on this device doesn't see it again
        // after a restore. Defaults to `false` for brand-new installs.
        onboardingSeen: snapshot.settings.onboardingSeen || existingPublic.onboardingSeen || false,
        // Carry the winning preference stamp forward.
        settingsUpdatedAt: keepLocalPrefs ? localStamp || undefined : snapStamp || undefined,
      };
      await database.settings.put({ key: 'current', ...merged });
      return {
        cards: snapshot.cards.length,
        entries: snapshot.entries.length,
        payments: payments.length,
        reminders: reminders.length,
        tombstones: tombstones.length,
      };
    },
  );
}
