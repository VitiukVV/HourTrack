import type { DriveSnapshot, Settings } from '@hourtrack/shared-types';

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
 * `applySnapshot` is its inverse for the cold-start / pull-merge path. It
 * REPLACES the local row sets with the snapshot's contents, after merging
 * the snapshot's tombstones into the local tombstone store. For the warm
 * conflict-resolution path callers should run `lwwMerge` themselves and then
 * `applySnapshot(merged)` with the merge result.
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

export async function applySnapshot(
  snapshot: DriveSnapshot,
  database: HourTrackDB = defaultDb,
): Promise<ApplySnapshotResult> {
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
      // Wipe + rewrite each store. bulkPut is idempotent on conflicting keys.
      await database.cards.clear();
      if (snapshot.cards.length > 0) {
        await database.cards.bulkPut(snapshot.cards);
      }
      await database.entries.clear();
      if (snapshot.entries.length > 0) {
        await database.entries.bulkPut(snapshot.entries);
      }
      // S27: payments ride the snapshot. Older (v2/v3) snapshots omit the
      // field — `validateSnapshot` backfills `[]`, but guard here too so a
      // direct `applySnapshot` on a legacy shape doesn't throw.
      const payments = snapshot.payments ?? [];
      await database.payments.clear();
      if (payments.length > 0) {
        await database.payments.bulkPut(payments);
      }
      // S28: reminders ride the snapshot. Older (v2/v3/v4) snapshots omit the
      // field — `validateSnapshot` backfills `[]`, but guard here too so a
      // direct `applySnapshot` on a legacy shape doesn't throw.
      const reminders = snapshot.reminders ?? [];
      await database.reminders.clear();
      if (reminders.length > 0) {
        await database.reminders.bulkPut(reminders);
      }
      const tombstones = snapshot.tombstones ?? [];
      await database.tombstones.clear();
      if (tombstones.length > 0) {
        await database.tombstones.bulkPut(tombstones);
      }
      // Merge Settings with care: keep local device bookkeeping.
      const existing = await database.settings.get('current');
      const existingPublic: Settings = existing
        ? (() => {
            const { key: _k, ...rest } = existing;
            return rest;
          })()
        : defaultSettings();
      const merged: Settings = {
        ...snapshot.settings,
        // Device-local fields kept from the existing row.
        deviceId: existingPublic.deviceId,
        driveDataFileId: existingPublic.driveDataFileId,
        driveDataEtag: existingPublic.driveDataEtag,
        // S13: pre-S13 snapshots predate `onboardingSeen`. If the inbound
        // snapshot omitted the field, prefer the LOCAL value so a user who
        // already dismissed the tour on this device doesn't see it again
        // after a restore. Defaults to `false` for brand-new installs.
        onboardingSeen: snapshot.settings.onboardingSeen ?? existingPublic.onboardingSeen ?? false,
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
