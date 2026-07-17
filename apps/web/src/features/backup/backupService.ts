import type { DriveSnapshot } from '@hourtrack/shared-types';

import { db as defaultDb, getSettings, updateSettings, type HourTrackDB } from '@/lib/db';
import { createJsonFile, deleteFile, listFiles, type DriveFileMeta } from '@/lib/google/drive';
import { buildSnapshot } from '@/lib/sync/snapshot';

/**
 * Backup service — creates timestamped snapshot files in the Drive App Folder
 * and prunes old ones.
 *
 * Storage layout (per PROJECT_PLAN.md §4 / sprint Notes):
 * - Backup files live next to `data.json` in `spaces=appDataFolder`. They are
 *   named `backups/YYYY-MM-DDTHHmm.json` — the leading `backups/` prefix is a
 *   NAME convention (Drive's `appDataFolder` has no true folders for app
 *   clients; we just use the slash so files sort + filter conveniently).
 * - The pre-restore safety variant is named `backups/pre-restore-{ts}.json`
 *   so a human looking at the list can tell them apart from regular cadenced
 *   backups.
 * - The lexicographically-sortable timestamp (`YYYY-MM-DDTHHmm`) is what makes
 *   rotation trivial: we sort the list by name and drop the oldest.
 *
 * Rotation policy:
 * - Keep the newest `BACKUP_KEEP_COUNT` (10) files matching the backup prefix.
 * - Pre-restore safety backups count against the same 10-file cap (sprint
 *   Notes #4-5: "Pre-restore safety backups count against this 10").
 * - Rotation is non-blocking: if delete-oldest fails, the backup creation
 *   still resolves successfully. We log the failure but don't rethrow.
 *
 * Format:
 * - Every backup file is a full `DriveSnapshot` (currently v2 since S16) —
 *   IDENTICAL shape to `data.json`. Restore is therefore
 *   `applySnapshot(parsed)` with no format translation. See `restoreBackup`
 *   for the consumer.
 *
 * The service is pure-function — it takes the access token + a Dexie DB as
 * arguments. The React surface (`BackupSection`, `RestoreModal`) reads tokens
 * via `useAuth()` and passes them through. Tests inject a `fetchImpl` per the
 * S10 pattern from `drive.ts`.
 */

export const BACKUP_PREFIX = 'backups/' as const;
export const PRE_RESTORE_PREFIX = 'backups/pre-restore-' as const;
export const BACKUP_KEEP_COUNT = 10 as const;

/** Filename format used by manual + auto backups: `backups/YYYY-MM-DDTHHmm.json`. */
export function formatBackupFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getUTCFullYear();
  const mo = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  return `${BACKUP_PREFIX}${y}-${mo}-${d}T${h}${mi}.json`;
}

/**
 * Filename format used by pre-restore safety backups. Uses the `ts` directly
 * rather than the truncated `YYYY-MM-DDTHHmm` form so that two safety backups
 * created within the same minute don't collide.
 */
export function formatPreRestoreFilename(date: Date): string {
  const iso = date.toISOString();
  // Replace `:` (not Drive-safe in titles per UX) and trim the millisecond
  // suffix so files sort cleanly next to the regular cadenced backups.
  const safe = iso.replace(/[:]/g, '').replace(/\..+Z$/, 'Z');
  return `${PRE_RESTORE_PREFIX}${safe}.json`;
}

export interface BackupFile {
  /** Drive file id — required for download + delete. */
  id: string;
  /** Full filename including `backups/` prefix. */
  name: string;
  /** ISO timestamp of Drive's `modifiedTime` (NOT the name-encoded timestamp). */
  modifiedTime: string | undefined;
  /** App properties (carries `schemaVersion`, `deviceId`). */
  appProperties: Record<string, string> | undefined;
  /** True if this is a pre-restore safety backup. */
  isPreRestore: boolean;
}

export interface CreateBackupOptions {
  accessToken: string;
  database?: HourTrackDB;
  fetchImpl?: typeof fetch;
  /**
   * Override the filename. Used by `createPreRestoreBackup` so the restore
   * flow can stash a safety snapshot under the `pre-restore-` prefix without
   * duplicating the upload logic.
   */
  filename?: string;
  /** Override `now` for deterministic filename generation in tests. */
  now?: Date;
  /**
   * If `false`, skip the rotation step. Used by `createPreRestoreBackup` —
   * the very-next step is a destructive restore that itself triggers a fresh
   * rotation, so doing it twice in a row would be wasted Drive calls.
   */
  rotate?: boolean;
}

export interface CreateBackupResult {
  file: BackupFile;
  /** ISO timestamp written to `Settings.lastBackupAt`. */
  backupAt: string;
  /** Number of older snapshots removed by rotation. */
  rotated: number;
}

/**
 * Create a new snapshot in `backups/` and update `Settings.lastBackupAt`.
 * Triggers rotation to keep at most `BACKUP_KEEP_COUNT` files.
 *
 * Concurrency: the function is NOT serialized at module level. Two parallel
 * `createBackup` calls would each upload + each rotate — Drive would end up
 * with both files and rotation would converge to 10 on the next run. This
 * matters for the auto-backup scheduler tick + a user-clicked "Create
 * backup now" racing each other; the worst-case is 11 files for ~ one
 * minute. Acceptable. If we ever need stricter mutual exclusion, move the
 * service onto the SyncManager's in-process Promise lock pattern.
 */
export async function createBackup(opts: CreateBackupOptions): Promise<CreateBackupResult> {
  const database = opts.database ?? defaultDb;
  const now = opts.now ?? new Date();
  const filename = opts.filename ?? formatBackupFilename(now);

  const snapshot = await buildSnapshot(database, { now });
  const appProperties: Record<string, string> = {
    // S28: bumped to '5' in lockstep with DriveSnapshot.schemaVersion (adds
    // the reminders store). The string form is what Drive's appProperties API
    // requires.
    schemaVersion: '5',
    deviceId: snapshot.deviceId,
    // Stamp the backup kind so the picker UI can render a label without
    // string-matching the filename.
    kind: filename.startsWith(PRE_RESTORE_PREFIX) ? 'pre-restore' : 'manual-or-auto',
  };

  const created = await createJsonFile<DriveSnapshot>(filename, snapshot, appProperties, {
    accessToken: opts.accessToken,
    fetchImpl: opts.fetchImpl,
  });

  const backupAt = now.toISOString();
  await updateSettings(database, { lastBackupAt: backupAt });

  let rotated = 0;
  if (opts.rotate !== false) {
    try {
      rotated = await rotateBackups({
        accessToken: opts.accessToken,
        database,
        fetchImpl: opts.fetchImpl,
      });
    } catch (err) {
      // Rotation failure must not fail the user-visible "create backup"
      // operation. Surface to console so devs can investigate.
      console.warn('[backupService] rotateBackups failed:', err);
    }
  }

  return {
    file: {
      id: created.fileId,
      name: filename,
      modifiedTime: created.modifiedTime,
      appProperties: created.appProperties,
      isPreRestore: filename.startsWith(PRE_RESTORE_PREFIX),
    },
    backupAt,
    rotated,
  };
}

export interface RotateBackupsOptions {
  accessToken: string;
  database?: HourTrackDB;
  fetchImpl?: typeof fetch;
  /** Override the keep-count for tests. */
  keepCount?: number;
}

/**
 * Delete the oldest backups until at most `keepCount` remain. Returns the
 * number of files deleted.
 *
 * "Oldest" is determined by the filename, NOT by Drive's `modifiedTime`:
 * the lexicographic order of `backups/YYYY-MM-DDTHHmm.json` is identical to
 * chronological order, and depending on `modifiedTime` would create
 * surprising results when a user manually re-uploads or restores a snapshot
 * (`modifiedTime` resets, but the date-stamped name doesn't).
 *
 * Pre-restore safety backups count against the cap. They sort by their `ts`
 * suffix so they interleave correctly with regular cadenced backups.
 */
export async function rotateBackups(opts: RotateBackupsOptions): Promise<number> {
  const keep = opts.keepCount ?? BACKUP_KEEP_COUNT;
  const files = await listBackupFiles({
    accessToken: opts.accessToken,
    fetchImpl: opts.fetchImpl,
  });
  if (files.length <= keep) return 0;
  // listBackupFiles returns newest-first. Drop the head `keep` items; the
  // tail is what we delete.
  const toDelete = files.slice(keep);
  let deleted = 0;
  for (const f of toDelete) {
    try {
      await deleteFile(f.id, {
        accessToken: opts.accessToken,
        fetchImpl: opts.fetchImpl,
      });
      deleted += 1;
    } catch (err) {
      console.warn('[backupService] deleteFile failed for', f.name, err);
    }
  }
  return deleted;
}

export interface ListBackupsOptions {
  accessToken: string;
  fetchImpl?: typeof fetch;
}

/**
 * Fetch every file under the `backups/` prefix in the appDataFolder. Returns
 * them newest-first by filename. Files whose names don't match either backup
 * prefix are filtered out — old `data.json` lives in the same Drive space.
 */
export async function listBackupFiles(opts: ListBackupsOptions): Promise<BackupFile[]> {
  const all: DriveFileMeta[] = await listFiles({
    accessToken: opts.accessToken,
    fetchImpl: opts.fetchImpl,
  });
  const filtered = all.filter((f) => f.name.startsWith(BACKUP_PREFIX));
  // Sort by name descending — names are date-stamped so this equals
  // chronological newest-first.
  filtered.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return filtered.map((f) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    appProperties: f.appProperties,
    isPreRestore: f.name.startsWith(PRE_RESTORE_PREFIX),
  }));
}

/**
 * Convenience wrapper for the restore flow: create a `backups/pre-restore-…`
 * snapshot WITHOUT triggering rotation. The follow-on restore will rotate
 * naturally on its next cadenced backup or via the user clicking "Create
 * backup now".
 */
export async function createPreRestoreBackup(
  opts: Omit<CreateBackupOptions, 'filename' | 'rotate'>,
): Promise<CreateBackupResult> {
  const now = opts.now ?? new Date();
  return createBackup({
    ...opts,
    filename: formatPreRestoreFilename(now),
    rotate: false,
    now,
  });
}

/**
 * Read whether the current Settings row indicates a successful prior backup.
 * Cheap helper used by UI to decide whether to enable the Restore button.
 */
export async function hasAnyBackup(database: HourTrackDB = defaultDb): Promise<boolean> {
  const settings = await getSettings(database);
  return !!settings?.lastBackupAt;
}
