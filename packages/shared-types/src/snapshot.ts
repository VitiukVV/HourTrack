import type { Card } from './card';
import type { Entry } from './entry';
import type { Settings } from './settings';

/**
 * DriveSnapshot -- the on-disk shape of `data.json` (and every file under
 * `backups/`) stored in the user's Google Drive App Folder.
 *
 * Mirrors PROJECT_PLAN.md §7.1 verbatim. Bump `schemaVersion` (and write a
 * migration before consuming older snapshots) on ANY breaking change to
 * `Card`, `Entry`, or `Settings`.
 */
export interface DriveSnapshot {
  /** Format version. Currently `1`. */
  schemaVersion: 1;
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
}
