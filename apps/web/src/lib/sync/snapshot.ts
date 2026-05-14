import type { DriveSnapshot, Settings } from '@hourtrack/shared-types';

import {
  db as defaultDb,
  getAllCards,
  getAllEntries,
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
 *   - the active tombstones (`pruneOldTombstones` is the SyncManager's job;
 *     buildSnapshot doesn't prune)
 *   - schemaVersion 1
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
  const [cards, entries, settings, tombstones, deviceId] = await Promise.all([
    getAllCards(database, true),
    getAllEntries(database),
    getSettings(database),
    getAllTombstones(database),
    getOrCreateDeviceId(database),
  ]);

  // Strip device-local bookkeeping that has no business in a cross-device
  // snapshot. Keep firstLoginAt / lastSyncAt / lastBackupAt — those ARE
  // user-meaningful and should propagate. The merge logic handles them.
  const safeSettings: Settings = settings ?? defaultSettings();
  return {
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    deviceId,
    settings: safeSettings,
    cards,
    entries,
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
  tombstones: number;
}

export async function applySnapshot(
  snapshot: DriveSnapshot,
  database: HourTrackDB = defaultDb,
): Promise<ApplySnapshotResult> {
  return database.transaction(
    'rw',
    database.cards,
    database.entries,
    database.tombstones,
    database.settings,
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
      };
      await database.settings.put({ key: 'current', ...merged });
      return {
        cards: snapshot.cards.length,
        entries: snapshot.entries.length,
        tombstones: tombstones.length,
      };
    },
  );
}
