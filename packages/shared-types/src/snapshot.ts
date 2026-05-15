import type { Card } from './card';
import type { Entry } from './entry';
import type { Settings } from './settings';
import type { Tombstone } from './tombstone';

/**
 * DriveSnapshot -- the on-disk shape of `data.json` (and every file under
 * `backups/`) stored in the user's Google Drive App Folder.
 *
 * Mirrors PROJECT_PLAN.md §7.1 verbatim. Bump `schemaVersion` (and write a
 * migration before consuming older snapshots) on ANY breaking change to
 * `Card`, `Entry`, or `Settings`.
 *
 * `tombstones` carries deletes that haven't been propagated to all devices
 * yet. Pruned after 30 days by `features/sync/lwwMerge.ts`.
 *
 * Changelog:
 *   v1 (S02) -- initial format.
 *   v2 (S16) -- adds `startMinutes` to Entry and `defaultStartMinutes` to
 *               Card to support time-of-day tracking. Per V2_FEATURE_PLAN
 *               decision #2 the migration is destructive: v1 snapshots are
 *               rejected by `validateSnapshot` (no backward-compat path),
 *               and the local Dexie store is wiped on the v4 -> v5 upgrade.
 */
export interface DriveSnapshot {
  /** Format version. Currently `2`. */
  schemaVersion: 2;
  /** ISO timestamp at the moment of export. */
  exportedAt: string;
  /**
   * Stable identifier for the originating device. Used by SyncManager (S10)
   * to detect "remote vs local origin" and resolve LWW conflicts.
   */
  deviceId: string;
  settings: Settings;
  /** ALL cards including archived ones (for cross-device restore parity). */
  cards: Card[];
  entries: Entry[];
  /**
   * Deletes recorded on any device that may not have propagated yet. Optional
   * in v1 reads for backwards-compatibility with the empty pre-S10 snapshots
   * — writers always emit `[]` at minimum.
   */
  tombstones?: Tombstone[];
}
