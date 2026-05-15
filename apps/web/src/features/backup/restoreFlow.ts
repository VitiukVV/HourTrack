import type { DriveSnapshot } from '@hourtrack/shared-types';

import { db as defaultDb, type HourTrackDB } from '@/lib/db';
import { readJsonFile } from '@/lib/google/drive';
import { applySnapshot } from '@/lib/sync/snapshot';
import { getSyncManager } from '@/features/sync/SyncManager';

import { createPreRestoreBackup } from './backupService';
import { validateSnapshot, type SnapshotValidationErrorCode } from './validateSnapshot';

/**
 * Restore flow orchestrator. Pure-function so it's unit-testable; the
 * `RestoreModal` component wraps it with confirmation UX.
 *
 * Flow (per sprint spec task #5 + Notes):
 *  1. Download the snapshot JSON from Drive by file id
 *  2. Validate via `validateSnapshot` (zod). Invalid → STOP, leave local data
 *     untouched
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
  /** True if the safety pre-restore backup succeeded. Diagnostic only. */
  safetyBackupCreated?: boolean;
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
  try {
    const mgr = getSyncManager();
    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();
  } catch (err) {
    // Push failures are non-fatal — the syncQueue row persists across
    // reload and the next mutation will retry. The pre-restore safety
    // backup is the user's recovery path if Drive truly can't be reached.
    console.warn('[restoreFlow] push after restore failed:', err);
  }

  return {
    outcome: 'success',
    applied,
    safetyBackupCreated,
  };
}
