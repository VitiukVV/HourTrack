import type { DriveSnapshot } from '@/shared/types';

import { db as defaultDb, type HourTrackDB } from '@/lib/db';
import { DriveAuthError, readJsonFile } from '@/lib/google/drive';
import { applySnapshot } from '@/lib/sync/snapshot';
import { getSyncManager, type PullOutcome } from '@/features/sync/SyncManager';

import { createPreRestoreBackup } from './backupService';
import { validateSnapshot, type SnapshotValidationErrorCode } from '@/lib/sync/validateSnapshot';

/**
 * Restore flow orchestrator. Pure-function so it's unit-testable; the
 * `RestoreModal` component wraps it with confirmation UX.
 *
 * Flow (per sprint spec task #5 + Notes):
 *  1. Download the snapshot JSON from Drive by file id
 *  2. Validate via `validateSnapshot` (zod). Invalid → STOP, leave local data
 *     untouched
 *  2b. Spec 016 review: pull first (`SyncManager.pullNow`), so the revision
 *     this device remembers is the shared copy's CURRENT one. Otherwise the
 *     push in step 5 would see a changed remote, download it and LWW-merge it
 *     INTO the restored data — newer remote rows winning, remote tombstones
 *     deleting restored rows: the restore merged away. A pull that does not
 *     succeed (offline, Google failing, signed out, newer-format file) STOPS
 *     the restore with local data untouched (`remoteCheckFailed`) — a restore
 *     must never quietly turn into a merge. The pull also means the safety
 *     backup below holds the other devices' latest rows.
 *  3. Write a pre-restore safety backup to `backups/pre-restore-{ts}.json`
 *     (sprint Notes #4). Failure of this step is logged but does NOT abort
 *     the restore — the user explicitly opted in, and refusing to restore
 *     because the safety net failed would create the worse failure mode
 *     ("Drive is messed up and now I can't recover at all"). Safety nets are
 *     best-effort.
 *  4. Wipe Dexie cards/entries/tombstones + apply the snapshot (handled
 *     atomically by `applySnapshot`)
 *  5. Enqueue a `pushDataJson` op so Drive's canonical `data.json` reflects
 *     the restored state. Without this, the next normal sync would diff the
 *     restored Dexie against the OLD `data.json` and might LWW the restored
 *     rows away.
 *  6. Caller (RestoreModal) triggers `window.location.reload()` so all
 *     in-memory React state (TanStack caches, active card store, etc.) is
 *     thrown away and re-hydrated cleanly from the restored Dexie.
 */

export type RestoreOutcome = 'success' | 'invalid' | 'failed';

const PULL_SUCCEEDED: ReadonlySet<PullOutcome> = new Set(['created', 'pulled', 'unchanged']);

export interface RestoreResult {
  outcome: RestoreOutcome;
  /** Counts of rows applied (success outcome only). */
  applied?: { cards: number; entries: number; tombstones: number };
  /** Human-readable error suitable for a toast / banner (failure cases). */
  error?: string;
  /**
   * S16: present on `outcome === 'invalid'`. Surfaces the validation
   * branch (`versionMismatch` / `missingTimeField` / `malformed`) so the
   * Restore modal can render targeted copy.
   */
  validationCode?: SnapshotValidationErrorCode;
  /**
   * Spec 016 review: present on `outcome === 'failed'` when the pre-restore
   * pull did not succeed. Nothing was changed.
   */
  remoteCheckFailed?: boolean;
  /** True if the safety pre-restore backup succeeded. Diagnostic only. */
  safetyBackupCreated?: boolean;
  /**
   * Spec 009: the restored state is NOT yet in Drive's `data.json`. A reload
   * now would bootstrap, pull the pre-restore `data.json` and merge it over
   * the restore — so the caller must not reload; the queued push retries
   * while the app stays open.
   */
  pushPending?: boolean;
}

export interface RunRestoreOptions {
  accessToken: string;
  /** Drive file id of the snapshot to restore from. */
  fileId: string;
  database?: HourTrackDB;
  fetchImpl?: typeof fetch;
  /** Override `now` for deterministic pre-restore filename in tests. */
  now?: Date;
}

export async function runRestore(opts: RunRestoreOptions): Promise<RestoreResult> {
  const database = opts.database ?? defaultDb;
  const now = opts.now ?? new Date();

  // 1. Download
  let pulled: { data: unknown };
  try {
    pulled = await readJsonFile<unknown>(opts.fileId, {
      accessToken: opts.accessToken,
      fetchImpl: opts.fetchImpl,
    });
  } catch (err) {
    // Nothing has been touched yet: let the caller renew the sign-in and retry.
    if (err instanceof DriveAuthError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    return { outcome: 'failed', error: `Failed to download snapshot: ${msg}` };
  }

  // 2. Validate BEFORE wiping anything
  const validation = validateSnapshot(pulled.data);
  if (!validation.ok) {
    return {
      outcome: 'invalid',
      error: validation.error,
      validationCode: validation.code,
    };
  }
  const snapshot: DriveSnapshot = validation.snapshot;

  // 2b. Bring the remembered revision up to date (see the header).
  const pull = await getSyncManager().pullNow();
  if (!PULL_SUCCEEDED.has(pull.outcome)) {
    console.warn('[restoreFlow] pre-restore pull did not succeed:', pull.outcome, pull.error);
    return {
      outcome: 'failed',
      error: `Could not check Google Drive before restoring (${pull.outcome})`,
      remoteCheckFailed: true,
    };
  }

  // 3. Pre-restore safety backup (best-effort)
  let safetyBackupCreated = false;
  try {
    await createPreRestoreBackup({
      accessToken: opts.accessToken,
      database,
      fetchImpl: opts.fetchImpl,
      now,
    });
    safetyBackupCreated = true;
  } catch (err) {
    console.warn('[restoreFlow] pre-restore backup failed (continuing):', err);
  }

  // 4. Wipe + apply (atomic within `applySnapshot`'s transaction)
  let applied;
  try {
    applied = await applySnapshot(snapshot, database);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      outcome: 'failed',
      error: `Failed to apply snapshot: ${msg}`,
      safetyBackupCreated,
    };
  }

  // 5. Push restored state back to `data.json` so other devices learn about
  //    the restore. CRITICAL: we must AWAIT the flush before the caller
  //    reloads. Otherwise the debounce timer is killed by the reload, the
  //    new AuthProvider mount runs bootstrap, and bootstrap pulls the
  //    pre-restore `data.json` and LWW-merges it against the just-restored
  //    Dexie — potentially overwriting the restore with stale state.
  //
  //    Spec 009: `flushNow` reports failure through the manager's status, not
  //    by rejecting, so success is read off the queue: a push row still there
  //    means `data.json` is stale. A flush already in flight when we enqueued
  //    read the queue before our row existed — hence the second drain.
  let pushPending = false;
  try {
    const mgr = getSyncManager();
    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();
    if (await hasQueuedPush(database)) await mgr.flushNow();
    pushPending = await hasQueuedPush(database);
  } catch (err) {
    console.error('[restoreFlow] push after restore failed:', err);
    pushPending = true;
  }

  return {
    outcome: 'success',
    applied,
    safetyBackupCreated,
    pushPending,
  };
}

async function hasQueuedPush(database: HourTrackDB): Promise<boolean> {
  return (await database.syncQueue.filter((r) => r.op === 'pushDataJson').count()) > 0;
}
