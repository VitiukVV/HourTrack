import type { DriveSnapshot } from '@hourtrack/shared-types';

import { db as defaultDb, getSettings, updateSettings, type HourTrackDB } from '@/lib/db';
import { createJsonFile, findFile, readJsonFile, DriveNotFoundError } from '@/lib/google/drive';
import { SCOPE_CALENDAR_APP_CREATED, SCOPE_DRIVE_APPDATA } from '@/lib/google/config';
import { applySnapshot, buildSnapshot } from '@/lib/sync/snapshot';

import { lwwMerge } from './lwwMerge';
import { recordConflicts } from './conflictLog';
import { getSyncManager } from './SyncManager';

/**
 * One-time sync bootstrap. Called on the first authed transition of every
 * session.
 *
 * Flow:
 *   1. Defensive: verify the user actually granted `drive.appdata` (the user
 *      could have revoked the scope server-side via Google account
 *      settings). If not, return `{ outcome: 'no-scope' }` so the caller
 *      surfaces a re-consent prompt.
 *   2. `findFile('data.json')` in the appDataFolder.
 *   3. If found: pull, LWW merge with local, apply merged, push if local
 *      diverged. Record any conflicts in the log.
 *   4. If NOT found: build local snapshot, create `data.json` on Drive.
 *   5. Cache the fileId + etag in Settings so steady-state pushes skip
 *      the find step.
 *   6. Stamp `Settings.lastSyncAt`.
 *
 * Idempotent — callers (AuthProvider in App) can fire this on every authed
 * transition without worrying about duplicate work. The Settings cache
 * (`driveDataFileId`) keeps subsequent boots fast.
 */

export type BootstrapOutcome =
  | 'created' // First time: created `data.json` on Drive.
  | 'merged-local-newer' // Drive existed; local had newer rows we pushed back.
  | 'merged-remote-newer' // Drive existed; remote had newer rows we pulled in.
  | 'in-sync' // Drive existed; nothing to do.
  | 'no-scope' // User hasn't granted drive.appdata.
  | 'no-token' // No access token available.
  | 'failed'; // Network/server error — caller may retry.

export interface BootstrapResult {
  outcome: BootstrapOutcome;
  fileId?: string;
  conflictCount?: number;
  error?: string;
  /**
   * S13: separate signal for "Drive worked but Calendar scope is missing."
   * Drive sync continues regardless — Calendar sync is independent. The
   * caller surfaces a re-consent toast for Calendar when this flag is set.
   * `undefined` when scope status is unknown (failed/no-token paths).
   */
  hasCalendarScope?: boolean;
}

export interface BootstrapOptions {
  database?: HourTrackDB;
  accessToken: string | null;
  grantedScopes: string | null;
  fetchImpl?: typeof fetch;
}

const DATA_FILE_NAME = 'data.json';

export async function runBootstrap(opts: BootstrapOptions): Promise<BootstrapResult> {
  const database = opts.database ?? defaultDb;
  if (!opts.accessToken) return { outcome: 'no-token' };
  if (!opts.grantedScopes || !opts.grantedScopes.split(' ').includes(SCOPE_DRIVE_APPDATA)) {
    return { outcome: 'no-scope' };
  }

  // S13: also surface Calendar scope status for the caller's reconsent
  // toast. Drive scope is satisfied at this point; Calendar scope is
  // checked independently.
  const hasCalendarScope = opts.grantedScopes.split(' ').includes(SCOPE_CALENDAR_APP_CREATED);

  const fetchImpl = opts.fetchImpl;
  const driveOpts = { accessToken: opts.accessToken, fetchImpl };

  try {
    // Check the Settings cache for a known fileId first to skip the search.
    const settings = await getSettings(database);
    let fileId = settings?.driveDataFileId ?? null;

    if (!fileId) {
      const found = await findFile(DATA_FILE_NAME, driveOpts);
      if (found) {
        fileId = found.id;
      }
    }

    if (!fileId) {
      // First-ever sync on this Drive — create the file.
      const local = await buildSnapshot(database);
      const created = await createJsonFile(
        DATA_FILE_NAME,
        local,
        { schemaVersion: '2', deviceId: local.deviceId },
        driveOpts,
      );
      await updateSettings(database, {
        driveDataFileId: created.fileId,
        driveDataEtag: created.etag,
        lastSyncAt: new Date().toISOString(),
      });
      return { outcome: 'created', fileId: created.fileId, conflictCount: 0, hasCalendarScope };
    }

    // File exists — pull, merge, apply, optionally push.
    let pulled: { data: DriveSnapshot; etag: string };
    try {
      pulled = await readJsonFile<DriveSnapshot>(fileId, driveOpts);
    } catch (err) {
      if (err instanceof DriveNotFoundError) {
        // Cache was stale; the file was deleted server-side. Recreate.
        const local = await buildSnapshot(database);
        const created = await createJsonFile(
          DATA_FILE_NAME,
          local,
          { schemaVersion: '2', deviceId: local.deviceId },
          driveOpts,
        );
        await updateSettings(database, {
          driveDataFileId: created.fileId,
          driveDataEtag: created.etag,
          lastSyncAt: new Date().toISOString(),
        });
        return { outcome: 'created', fileId: created.fileId, conflictCount: 0, hasCalendarScope };
      }
      throw err;
    }

    const local = await buildSnapshot(database);
    const { snapshot: merged, conflictsResolved } = lwwMerge(local, pulled.data);
    recordConflicts(conflictsResolved);

    const localChangedFromMerge = !snapshotsEqual(local, merged);
    const remoteChangedFromMerge = !snapshotsEqual(pulled.data, merged);

    // Always apply the merged snapshot locally so the UI reflects the union
    // of writes from both sides. `applySnapshot` is a no-op if `merged` is
    // byte-identical to the local state — but cheap enough that we don't
    // gate the call.
    await applySnapshot(merged, database);

    // Cache the etag we just observed. The SyncManager will use it on the
    // next push as `If-Match`.
    await updateSettings(database, {
      driveDataFileId: fileId,
      driveDataEtag: pulled.etag,
      lastSyncAt: new Date().toISOString(),
    });

    let outcome: BootstrapOutcome;
    if (!localChangedFromMerge && !remoteChangedFromMerge) {
      outcome = 'in-sync';
    } else if (localChangedFromMerge && !remoteChangedFromMerge) {
      // Local diverged from merge — we have newer remote rows. (Merge
      // preferred remote on at least one row.) Treat as "remote-newer".
      outcome = 'merged-remote-newer';
    } else if (!localChangedFromMerge && remoteChangedFromMerge) {
      outcome = 'merged-local-newer';
    } else {
      // Both sides contributed — pick the dominant direction by which side
      // shrunk less. This is informational only.
      outcome =
        local.cards.length + local.entries.length >=
        pulled.data.cards.length + pulled.data.entries.length
          ? 'merged-local-newer'
          : 'merged-remote-newer';
    }

    // When local had rows that weren't on Drive, the merged snapshot won't
    // be reflected on Drive until the next mutation triggers a push. If the
    // user signs out before making another change, those rows live only on
    // this device. Kick a push immediately to flush the bootstrap-induced
    // divergence to Drive.
    if (outcome === 'merged-local-newer' || outcome === 'merged-remote-newer') {
      try {
        await getSyncManager().enqueue({ op: 'pushDataJson' });
      } catch (err) {
        console.warn('[sync] post-bootstrap push enqueue failed:', err);
      }
    }

    return {
      outcome,
      fileId,
      conflictCount: conflictsResolved.length,
      hasCalendarScope,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { outcome: 'failed', error: msg };
  }
}

/**
 * Cheap structural equality for two snapshots — used by bootstrap to decide
 * whether the local OR remote side diverged from the merged result.
 *
 * S23 Task 28 — replace `JSON.stringify(sortById(...))` with a fingerprint
 * string. We only need to know whether the union of `(id, updatedAt)`
 * pairs is identical between the two sides, not the full row payload:
 * LWW merge is deterministic from those two fields per row, so two
 * snapshots whose `(id, updatedAt)` multisets agree must produce the
 * same merge result and thus be considered "equal" for divergence
 * detection.
 *
 * The fingerprint avoids JSON.stringify on large arrays (which allocates
 * O(N) bytes of string + GC pressure proportional to the snapshot size).
 * For a user with 5 cards + 2000 entries, the legacy shape allocated
 * ~150 KB of JSON per call, twice (local + remote). The fingerprint is
 * just `id + '\0' + updatedAt` per row, joined with `'\0'` — roughly an
 * order of magnitude less allocation and no JSON parser overhead.
 */
function snapshotsEqual(a: DriveSnapshot, b: DriveSnapshot): boolean {
  if (a.cards.length !== b.cards.length) return false;
  if (a.entries.length !== b.entries.length) return false;
  const at = a.tombstones ?? [];
  const bt = b.tombstones ?? [];
  if (at.length !== bt.length) return false;
  return (
    fingerprintById(a.cards) === fingerprintById(b.cards) &&
    fingerprintById(a.entries) === fingerprintById(b.entries) &&
    fingerprintTombstones(at) === fingerprintTombstones(bt)
  );
}

/**
 * `id + '\0' + updatedAt` per row, joined by `'\0'`. The NUL byte is a
 * safe separator because neither id (UUID) nor `updatedAt` (ISO 8601)
 * contains it. Sorted by id ascending for deterministic order.
 */
function fingerprintById(rows: { id: string; updatedAt: string }[]): string {
  return rows
    .slice()
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .map((row) => `${row.id}\0${row.updatedAt}`)
    .join('\0');
}

function fingerprintTombstones(rows: { entityId: string; deletedAt: string }[]): string {
  return rows
    .slice()
    .sort((x, y) => (x.entityId < y.entityId ? -1 : x.entityId > y.entityId ? 1 : 0))
    .map((row) => `${row.entityId}\0${row.deletedAt}`)
    .join('\0');
}
