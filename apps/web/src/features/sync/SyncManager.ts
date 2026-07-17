import type { DriveSnapshot } from '@hourtrack/shared-types';

import {
  db as defaultDb,
  enqueueSyncOp,
  getReadySyncQueueRows,
  deleteSyncQueueRow,
  rescheduleSyncQueueRow,
  getSettings,
  updateSettings,
  pruneOldTombstones,
  type HourTrackDB,
  type SyncQueueRow,
} from '@/lib/db';
import {
  createJsonFile,
  findFile,
  readJsonFile,
  updateJsonFile,
  DriveEtagMismatchError,
  DriveNotFoundError,
} from '@/lib/google/drive';
import { applySnapshot, buildSnapshot } from '@/lib/sync/snapshot';
import { SCOPE_CALENDAR_APP_CREATED, SCOPE_DRIVE_APPDATA } from '@/lib/google/config';
import { getTokens } from '@/lib/google/tokenStore';

import { validatePulledSnapshot } from '@/features/backup/validateSnapshot';

import { lwwMerge } from './lwwMerge';
import { nextRetryDelay } from './retryPolicy';
import { recordConflicts } from './conflictLog';
import { emitSnapshotApplied } from './snapshotEvents';
import {
  handleBulkUpdateCardEvents,
  handleCreateCalendarEvent,
  handleCreateReminderEvent,
  handleDeleteCalendarEvent,
  handleDeleteReminderEvent,
  handleUpdateCalendarEvent,
  handleUpdateReminderEvent,
} from './handlers/calendarOps';

/**
 * SyncManager — the singleton orchestrator that ties Dexie writes to Drive.
 *
 * Responsibilities:
 *   1. `enqueue(op)` — append work to the Dexie `syncQueue`. The hooks layer
 *      (`useCards`, `useEntries`) calls this after every mutation.
 *   2. Debounce — multiple `pushDataJson` enqueues within 1s coalesce to a
 *      single push. Implemented at the kickoff layer: a queued op stays in
 *      Dexie; `flush()` reads the LATEST snapshot at run time and uploads
 *      ONCE, then deletes all coalesced rows.
 *   3. In-process lock — only one `flush()` cycle runs at a time. Subsequent
 *      calls wait for the in-flight promise. Prevents two browser-tab
 *      visibility events from racing the same push.
 *   4. Conflict resolution — 412 from Drive triggers pull + LWW merge +
 *      retry. The retry resets `attempts` because the previous failure
 *      wasn't a real failure, it was a "concurrent edit" signal.
 *   5. Offline awareness — the manager listens to `online` / `offline`
 *      window events. When offline, `flush()` returns early without
 *      touching the queue; rows wait in Dexie until reconnect.
 *   6. Retry policy — failed pushes (network errors, 5xx) reschedule via
 *      `nextRetryDelay(attempts)`. Failed `deleteCalendarEvent` ops are
 *      retried separately by their own handler (no-op stub in S10; S12
 *      replaces).
 *
 * Status model (`SyncStatus`):
 *   - 'idle'    -- queue empty + last flush succeeded
 *   - 'syncing' -- flush in progress
 *   - 'offline' -- `navigator.onLine === false`
 *   - 'error'   -- last flush threw; queue rows persist with `lastError`
 *
 * The class is designed to be instantiated as a module-level singleton
 * (see bottom of file). Tests can construct fresh instances.
 */

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncManagerOptions {
  /** Dexie DB instance. Defaults to the singleton from `@/lib/db`. */
  database?: HourTrackDB;
  /** Coalesce window for `pushDataJson` enqueues. */
  debounceMs?: number;
  /** Override the `fetch` impl for tests. */
  fetchImpl?: typeof fetch;
  /**
   * Override the access-token reader (for tests). Defaults to reading from
   * the Dexie tokenStore. Returns the bearer string or `null`.
   */
  getAccessToken?: () => Promise<string | null>;
  /**
   * Override the granted-scopes reader. Returns the space-separated scope
   * string Google echoed back. Used for the defensive scope check.
   */
  getGrantedScopes?: () => Promise<string | null>;
  /** Whether to attach window online/offline listeners. */
  attachWindowListeners?: boolean;
}

const DATA_FILE_NAME = 'data.json' as const;
const DEFAULT_DEBOUNCE_MS = 1_000;

type StatusListener = (status: SyncStatus, lastError?: string) => void;

export class SyncManager {
  /**
   * The DB instance is resolved LAZILY on each call (via `resolveDatabase`)
   * so that ESM live bindings to the `@/lib/db` singleton are honored. In
   * tests that mock `@/lib/db.db` via `vi.mock` with a getter, capturing
   * the reference at constructor time would freeze the SyncManager to the
   * FIRST test's testDb instance — subsequent tests would write to a
   * deleted DB and silently fail. Resolving lazily keeps the singleton
   * test-friendly.
   */
  private readonly explicitDatabase: HourTrackDB | undefined;
  private readonly debounceMs: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly getAccessToken: () => Promise<string | null>;
  private readonly getGrantedScopes: () => Promise<string | null>;
  private readonly attachWindowListeners: boolean;

  /** In-flight flush promise — null when no flush is running. */
  private flushInFlight: Promise<void> | null = null;
  /** Debounce timer id — null when no kickoff is pending. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Latest known status. */
  private status: SyncStatus = 'idle';
  private lastError: string | undefined;
  private readonly listeners = new Set<StatusListener>();
  /** Disposers for window listeners (so we can detach in tests). */
  private windowDisposers: Array<() => void> = [];

  constructor(opts: SyncManagerOptions = {}) {
    this.explicitDatabase = opts.database;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.fetchImpl = opts.fetchImpl;
    this.getAccessToken =
      opts.getAccessToken ??
      (async () => {
        const tokens = await getTokens(this.resolveDatabase());
        return tokens?.accessToken ?? null;
      });
    this.getGrantedScopes =
      opts.getGrantedScopes ??
      (async () => {
        const tokens = await getTokens(this.resolveDatabase());
        return tokens?.scope ?? null;
      });
    this.attachWindowListeners = opts.attachWindowListeners ?? true;
    if (this.attachWindowListeners && typeof window !== 'undefined') {
      this.installWindowListeners();
    }
    this.refreshOfflineStatus();
  }

  private resolveDatabase(): HourTrackDB {
    return this.explicitDatabase ?? defaultDb;
  }

  /**
   * Append a sync op to the queue. `pushDataJson` ops use the debounce
   * window — multiple enqueues within `debounceMs` only kick off ONE flush.
   * Other ops (e.g. `deleteCalendarEvent`) are dispatched on the next
   * flush tick.
   *
   * S13: anonymous-user enqueue gate. If no access token is available
   * (user signed out, or never signed in), the op is silently dropped
   * rather than written to Dexie. Without this gate every Dexie mutation
   * accumulated a row in `syncQueue` that flush() then rejected with
   * `'No access token'`, polluting the dev-mode error log and producing
   * a non-trivial backlog the user would have to clear by signing in.
   * Per the S10 followup, gating at the queue boundary is cleaner than
   * gating each call site.
   */
  async enqueue(op: {
    op:
      | 'pushDataJson'
      | 'createCalendarEvent'
      | 'updateCalendarEvent'
      | 'deleteCalendarEvent'
      | 'bulkUpdateCardEvents'
      | 'createReminderEvent'
      | 'updateReminderEvent'
      | 'deleteReminderEvent';
    mutation?: 'create' | 'update' | 'delete';
    entityType?: 'card' | 'entry' | 'reminder';
    entityId?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) {
      // No auth → drop the op silently. The local Dexie write already
      // succeeded; the row will be picked up on the next bootstrap
      // (which rebuilds a fresh snapshot from current Dexie state) if
      // the user signs in later.
      return;
    }
    await enqueueSyncOp(this.resolveDatabase(), op);
    this.scheduleFlush();
  }

  /** Cancel the pending debounce + run flush immediately. */
  async flushNow(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.flush();
  }

  /** Public subscribe to status updates. Fires immediately with current state. */
  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status, this.lastError);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  getLastError(): string | undefined {
    return this.lastError;
  }

  /** Tear down listeners and reject in-flight work. Used by tests. */
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const d of this.windowDisposers) d();
    this.windowDisposers = [];
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private setStatus(next: SyncStatus, lastError?: string): void {
    this.status = next;
    this.lastError = lastError;
    for (const l of this.listeners) {
      try {
        l(next, lastError);
      } catch {
        // Listener errors must not poison sibling listeners.
      }
    }
  }

  private refreshOfflineStatus(): void {
    if (typeof navigator === 'undefined') return;
    if (!navigator.onLine) {
      this.setStatus('offline');
    } else if (this.status === 'offline') {
      this.setStatus('idle');
    }
  }

  private installWindowListeners(): void {
    const onOnline = () => {
      this.refreshOfflineStatus();
      // Kick off a flush to drain anything queued while offline.
      void this.flush().catch(() => {
        /* errors are stored in status; don't bubble */
      });
    };
    const onOffline = () => {
      this.setStatus('offline');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    this.windowDisposers.push(() => window.removeEventListener('online', onOnline));
    this.windowDisposers.push(() => window.removeEventListener('offline', onOffline));
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) return; // Already pending.
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush().catch(() => {
        /* swallow — status carries the error */
      });
    }, this.debounceMs);
  }

  /**
   * Drain the queue. Honors the in-process lock: if a flush is already
   * running, returns the in-flight promise instead of starting a second
   * pipeline.
   */
  async flush(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight;
    this.flushInFlight = this.runFlush().finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  private async runFlush(): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setStatus('offline');
      return;
    }

    const database = this.resolveDatabase();
    const rows = await getReadySyncQueueRows(database);
    if (rows.length === 0) {
      this.setStatus('idle');
      return;
    }

    // Defensive scope check — bail out cleanly if the user hasn't granted
    // the Drive App Folder scope. Surfaces an error state but doesn't loop.
    const scope = await this.getGrantedScopes();
    if (!scope || !scope.split(' ').includes(SCOPE_DRIVE_APPDATA)) {
      this.setStatus('error', 'Drive scope not granted');
      return;
    }

    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      this.setStatus('error', 'No access token');
      return;
    }

    this.setStatus('syncing');

    // Group rows by op so coalesced `pushDataJson` ops handle as a batch.
    const pushRows = rows.filter((r) => r.op === 'pushDataJson');
    const calendarRows = rows.filter((r) =>
      (
        [
          'createCalendarEvent',
          'updateCalendarEvent',
          'deleteCalendarEvent',
          'bulkUpdateCardEvents',
          'createReminderEvent',
          'updateReminderEvent',
          'deleteReminderEvent',
        ] as const
      ).includes(r.op as never),
    );

    let flushError: string | undefined;

    if (pushRows.length > 0) {
      try {
        await this.doPushDataJson(accessToken, database);
        // All coalesced rows are cleared on a single successful push.
        for (const r of pushRows) {
          if (r.id !== undefined) {
            await deleteSyncQueueRow(database, r.id);
          }
        }
      } catch (err) {
        flushError = err instanceof Error ? err.message : String(err);
        for (const r of pushRows) {
          if (r.id !== undefined) {
            const delay = nextRetryDelay(r.attempts ?? 0);
            await rescheduleSyncQueueRow(database, r.id, delay, flushError);
          }
        }
      }
    }

    if (calendarRows.length > 0) {
      // Defensive: ensure the user actually granted the Calendar scope before
      // attempting Calendar API calls. If not, leave the rows queued with an
      // error message so the next sign-in / re-consent flow can drain them.
      const hasCalendarScope = scope.split(' ').includes(SCOPE_CALENDAR_APP_CREATED);
      if (!hasCalendarScope) {
        flushError = flushError ?? 'Calendar scope not granted';
        for (const r of calendarRows) {
          if (r.id !== undefined) {
            const delay = nextRetryDelay(r.attempts ?? 0);
            await rescheduleSyncQueueRow(database, r.id, delay, 'Calendar scope not granted');
          }
        }
      } else {
        for (const r of calendarRows) {
          try {
            await this.dispatchCalendarOp(r, accessToken, database);
            if (r.id !== undefined) {
              await deleteSyncQueueRow(database, r.id);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            flushError = flushError ?? msg;
            if (r.id !== undefined) {
              const delay = nextRetryDelay(r.attempts ?? 0);
              await rescheduleSyncQueueRow(database, r.id, delay, msg);
            }
          }
        }
      }
    }

    if (flushError) {
      this.setStatus('error', flushError);
      return;
    }

    // S29 (UR-29-3): a mutation may have been enqueued AFTER this run captured
    // its `rows` snapshot (e.g. the user edited an entry while the push was
    // in-flight). Those rows would otherwise sit in Dexie until the NEXT
    // unrelated mutation, and the status would falsely read 'idle' ("synced")
    // while ready work remains. If ready rows remain, stay 'syncing' and
    // schedule another drain. This does NOT tight-loop: rows either succeed
    // (deleted) or fail (rescheduled to a FUTURE `nextAttemptAt`, so they are
    // no longer "ready"), so the chain terminates when genuine new work drains.
    const remaining = await getReadySyncQueueRows(database);
    if (remaining.length > 0) {
      this.setStatus('syncing');
      this.scheduleFlush();
    } else {
      this.setStatus('idle');
    }
  }

  /**
   * Dispatch a single calendar op to its dedicated handler. Each handler
   * already takes care of stamping the entry's `syncStatus` / `syncError` /
   * `googleEventId` — this method only owns queue-row lifecycle.
   */
  private async dispatchCalendarOp(
    row: SyncQueueRow,
    accessToken: string,
    database: HourTrackDB,
  ): Promise<void> {
    const opts = {
      accessToken,
      database,
      fetchImpl: this.fetchImpl,
    };
    switch (row.op) {
      case 'createCalendarEvent': {
        if (!row.entityId) return;
        await handleCreateCalendarEvent(row.entityId, opts);
        return;
      }
      case 'updateCalendarEvent': {
        if (!row.entityId) return;
        await handleUpdateCalendarEvent(row.entityId, opts);
        return;
      }
      case 'deleteCalendarEvent': {
        const googleEventId = (row.payload?.googleEventId as string | undefined) ?? null;
        if (!googleEventId) return;
        await handleDeleteCalendarEvent(googleEventId, opts);
        return;
      }
      case 'bulkUpdateCardEvents': {
        if (!row.entityId) return;
        await handleBulkUpdateCardEvents(row.entityId, opts);
        return;
      }
      case 'createReminderEvent': {
        if (!row.entityId) return;
        await handleCreateReminderEvent(row.entityId, opts);
        return;
      }
      case 'updateReminderEvent': {
        if (!row.entityId) return;
        await handleUpdateReminderEvent(row.entityId, opts);
        return;
      }
      case 'deleteReminderEvent': {
        const googleEventId = (row.payload?.googleEventId as string | undefined) ?? null;
        if (!googleEventId) return;
        await handleDeleteReminderEvent(googleEventId, opts);
        return;
      }
      default:
        return;
    }
  }

  /**
   * Build a snapshot from Dexie, push it to Drive at `data.json`. On 412
   * (ETag mismatch) pull the remote, LWW-merge, and try ONE more push.
   *
   * Updates `settings.lastSyncAt`, `settings.driveDataEtag`,
   * `settings.driveDataFileId` on success. Prunes tombstones older than 30
   * days before the push.
   */
  private async doPushDataJson(accessToken: string, database: HourTrackDB): Promise<void> {
    await pruneOldTombstones(database, 30);

    const settings = await getSettings(database);
    let fileId = settings?.driveDataFileId ?? null;
    let etag = settings?.driveDataEtag ?? null;

    // Locate the file on first run.
    if (!fileId) {
      const found = await findFile(DATA_FILE_NAME, {
        accessToken,
        fetchImpl: this.fetchImpl,
      });
      if (found) {
        fileId = found.id;
        etag = found.etag;
      }
    }

    // Build the snapshot AFTER locating the remote (Dexie reads are cheap;
    // doing it later guarantees we capture the most-recent local state).
    const snapshot = await buildSnapshot(database);

    const appProperties: Record<string, string> = {
      // Derive from the snapshot body so the Drive metadata marker can never
      // drift from the actual schema written (was hardcoded '2' while
      // buildSnapshot writes 3 since S21).
      schemaVersion: String(snapshot.schemaVersion),
      deviceId: snapshot.deviceId,
    };

    if (!fileId) {
      // First sync — create the file.
      const created = await createJsonFile(DATA_FILE_NAME, snapshot, appProperties, {
        accessToken,
        fetchImpl: this.fetchImpl,
      });
      await updateSettings(database, {
        driveDataFileId: created.fileId,
        driveDataEtag: created.etag,
        lastSyncAt: new Date().toISOString(),
      });
      return;
    }

    // Subsequent sync — update with If-Match.
    try {
      const updated = await updateJsonFile(fileId, snapshot, etag, {
        accessToken,
        fetchImpl: this.fetchImpl,
        appProperties,
      });
      await updateSettings(database, {
        driveDataFileId: updated.fileId,
        driveDataEtag: updated.etag,
        lastSyncAt: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof DriveEtagMismatchError) {
        // Pull, merge, push exactly once. We do NOT loop — a second 412
        // means someone is writing faster than our debounce; surface as an
        // error and let the retry policy take over.
        const pulled = await readJsonFile<DriveSnapshot>(fileId, {
          accessToken,
          fetchImpl: this.fetchImpl,
        });
        // S31 (UR-31-6): validate the pulled snapshot BEFORE merging. A
        // truncated / null-array `data.json` used to crash `lwwMerge` with a
        // hard TypeError, wedging sync (this push would retry forever). A thrown
        // `InvalidSnapshotError` is caught by runFlush, rescheduled, and
        // recovered once a well-formed snapshot lands.
        const validated = validatePulledSnapshot(pulled.data);
        const { snapshot: merged, conflictsResolved } = lwwMerge(snapshot, validated);
        recordConflicts(conflictsResolved);
        // S29: row-wise LWW apply (NOT clear-and-rewrite) so a local write
        // made after `snapshot` was built survives this 412 merge. Then emit
        // so the UI invalidates and shows the pulled rows without a reload.
        await applySnapshot(merged, database, { mode: 'merge' });
        emitSnapshotApplied();
        const retried = await updateJsonFile(fileId, merged, pulled.etag, {
          accessToken,
          fetchImpl: this.fetchImpl,
          appProperties,
        });
        await updateSettings(database, {
          driveDataFileId: retried.fileId,
          driveDataEtag: retried.etag,
          lastSyncAt: new Date().toISOString(),
        });
        return;
      }
      if (err instanceof DriveNotFoundError) {
        // File was deleted server-side. Recreate.
        const recreated = await createJsonFile(DATA_FILE_NAME, snapshot, appProperties, {
          accessToken,
          fetchImpl: this.fetchImpl,
        });
        await updateSettings(database, {
          driveDataFileId: recreated.fileId,
          driveDataEtag: recreated.etag,
          lastSyncAt: new Date().toISOString(),
        });
        return;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let singleton: SyncManager | null = null;

/**
 * Return the module-level singleton, creating it on first call. Tests that
 * need isolation should construct their own `new SyncManager({...})` with
 * `attachWindowListeners: false`.
 */
export function getSyncManager(): SyncManager {
  if (!singleton) {
    singleton = new SyncManager();
  }
  return singleton;
}

/** Test-only — reset the singleton. */
export function _resetSyncManagerForTesting(): void {
  if (singleton) {
    singleton.dispose();
  }
  singleton = null;
}
