import type { DriveSnapshot } from '@/shared/types';

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
  readFileMeta,
  readJsonFile,
  updateJsonFile,
  DriveAuthError,
  DriveNotFoundError,
  type DriveFileMeta,
} from '@/lib/google/drive';
import { applySnapshot, buildSnapshot } from '@/lib/sync/snapshot';
import { sameRows } from '@/lib/sync/snapshotFingerprint';
import { SCOPE_CALENDAR_APP_CREATED, SCOPE_DRIVE_APPDATA } from '@/lib/google/config';
import { getTokens } from '@/lib/google/tokenStore';
import { forceRenewAccessToken, getFreshAccessToken } from '@/lib/google/tokenRefresh';
import { CalendarAuthError } from '@/lib/google/calendar';

import {
  RemoteSchemaNewerError,
  snapshotCarriesCardRanks,
  validatePulledSnapshot,
} from '@/lib/sync/validateSnapshot';

import { lwwMerge } from './lwwMerge';
import { SYNC_UPDATE_REQUIRED } from './syncErrorMessage';
import { nextRetryDelay } from './retryPolicy';
import { recordConflicts } from './conflictLog';
import {
  handleBulkUpdateCardEvents,
  handleCreateCalendarEvent,
  handleCreateReminderEvent,
  handleDeleteCalendarEvent,
  handleDeleteReminderEvent,
  handleUpdateCalendarEvent,
  handleUpdateReminderEvent,
} from '@/features/calendar-sync/calendarOps';

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
 *   4. Pull before push (spec 016) — every upload runs inside `syncCycle`:
 *      read the file's Drive `version`; when it differs from the one this
 *      device remembers, download + validate + LWW merge + apply first, then
 *      upload the merged snapshot. `pullNow()` runs the same cycle without a
 *      requested upload (it still uploads when the remote lacks local rows).
 *      Pulls and flushes share one lock, so they never overlap.
 *   5. Offline awareness — the manager listens to `online` / `offline`
 *      window events. When offline, `flush()` returns early without
 *      touching the queue; rows wait in Dexie until reconnect.
 *   6. Retry policy — failed pushes (network errors, 5xx) reschedule via
 *      `nextRetryDelay(attempts)`. Failed `deleteCalendarEvent` ops are
 *      retried separately by their own handler (no-op stub in S10; S12
 *      replaces).
 *   7. Newer-format guard (spec 016 FR-008) — see `updateRequired`.
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
   * Override the access-token reader (for tests). Defaults to
   * `getFreshAccessToken`: the stored token, renewed first when it is about
   * to expire (spec 014). Returns the bearer string or `null`.
   */
  getAccessToken?: () => Promise<string | null>;
  /**
   * Whether a change should be queued at all (spec 016 FR-009). Defaults to
   * "a sign-in is stored" (`getTokens()`): no renewal, no network, so the
   * queue row is written before a closing tab can lose it. Deliberately NOT
   * derived from an injected `getAccessToken` — tests that enqueue say so.
   */
  isSignedIn?: () => Promise<boolean>;
  /**
   * Renew the sign-in after Google rejected a request as unauthorized (spec
   * 014). Returns the renewed token, or `null` when renewal failed. Defaults
   * to the single-flight `forceRenewAccessToken`.
   */
  forceRenewAccessToken?: () => Promise<string | null>;
  /**
   * Override the granted-scopes reader. Returns the space-separated scope
   * string Google echoed back. Used for the defensive scope check.
   */
  getGrantedScopes?: () => Promise<string | null>;
  /** Whether to attach window online/offline listeners. */
  attachWindowListeners?: boolean;
  /**
   * Override the retry backoff (ms) for a row that has already failed
   * `attempts` times. Defaults to `nextRetryDelay`. Tests shrink it rather
   * than use fake timers, which deadlock with fake-indexeddb.
   */
  computeRetryDelay?: (attempts: number) => number;
}

const DATA_FILE_NAME = 'data.json' as const;
const DEFAULT_DEBOUNCE_MS = 1_000;

type StatusListener = (status: SyncStatus, lastError?: string) => void;

/**
 * What a `pullNow()` did:
 *   - 'created'   — no `data.json` existed; this device's data created it.
 *   - 'pulled'    — the remote had changed; it was downloaded and merged
 *                   (and uploaded back when it lacked local rows).
 *   - 'unchanged' — the remote `version` matched; nothing was downloaded.
 *   - 'no-token' / 'no-scope' / 'offline' — nothing was attempted.
 *   - 'update-required' — the remote is in a newer format (spec 016 §3).
 *   - 'failed'    — a network / server / validation error; retry later.
 */
export type PullOutcome =
  | 'created'
  | 'pulled'
  | 'unchanged'
  | 'no-token'
  | 'no-scope'
  | 'offline'
  | 'update-required'
  | 'failed';

export interface PullResult {
  outcome: PullOutcome;
  /** Rows where both sides differed and LWW picked one (0 when nothing merged). */
  conflictCount: number;
  /** Whether the Calendar scope is granted — Drive sync does not depend on it. */
  hasCalendarScope: boolean;
  error?: string;
}

interface CycleResult {
  outcome: 'created' | 'pulled' | 'unchanged';
  conflictCount: number;
}

function appPropertiesOf(snapshot: DriveSnapshot): Record<string, string> {
  // Derived from the snapshot body so the Drive metadata marker can never
  // drift from the schema actually written.
  return { schemaVersion: String(snapshot.schemaVersion), deviceId: snapshot.deviceId };
}

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
  private readonly isSignedIn: () => Promise<boolean>;
  private readonly forceRenewAccessToken: () => Promise<string | null>;
  private readonly getGrantedScopes: () => Promise<string | null>;
  private readonly attachWindowListeners: boolean;
  /**
   * Backoff policy. Injectable so tests can shrink the schedule instead of
   * reaching for fake timers — those deadlock against fake-indexeddb here
   * (see the S28 journal).
   */
  private readonly computeRetryDelay: (attempts: number) => number;

  /** In-flight (or lock-queued) flush promise — null when none is pending. */
  private flushInFlight: Promise<void> | null = null;
  /** In-flight (or lock-queued) pull promise — null when none is pending. */
  private pullInFlight: Promise<PullResult> | null = null;
  /**
   * Tail of the Drive lock (FR-011): flushes and pulls chain onto it so a
   * pull never reads or writes `data.json` while a push is in progress, and
   * vice versa.
   */
  private lockTail: Promise<unknown> = Promise.resolve();
  /** Debounce timer id — null when no kickoff is pending. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Retry timer id — armed after a failed flush so the backoff the queue
   * rows were rescheduled with actually fires. Without it, `nextRetryDelay`
   * only decided WHEN a row becomes ready again; nothing woke the manager up
   * to drain it, so a failed push waited for the user's next edit or an
   * `online` event. On a personal tracker that can mean the change never
   * reaches Drive during the session.
   */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Back-to-back flushes that failed outside the per-op handling (spec 009).
   * Their rows keep their old `attempts`, so this count drives the backoff
   * instead — a lasting fault must not re-push every base interval forever.
   */
  private consecutiveFlushFailures = 0;
  /**
   * Spec 016 FR-008: the shared `data.json` was written by a newer app. While
   * set, nothing is uploaded: `pushDataJson` rows stay queued untouched (no
   * reschedule, no retry timer), calendar ops still run, and the status reads
   * `'error'` / `SYNC_UPDATE_REQUIRED`. Cleared by the next cycle that reads
   * a supported file — only `pullNow` runs one while set; in practice that is
   * the first pull after the app update reloads (a new manager starts clear).
   */
  private updateRequired = false;
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
    // Renewed first when it is about to expire: the renewal timer does not
    // run while a phone has the PWA in the background (spec 014).
    this.getAccessToken = opts.getAccessToken ?? (() => getFreshAccessToken());
    this.isSignedIn =
      opts.isSignedIn ?? (async () => (await getTokens(this.resolveDatabase())) !== null);
    this.forceRenewAccessToken = opts.forceRenewAccessToken ?? forceRenewAccessToken;
    this.getGrantedScopes =
      opts.getGrantedScopes ??
      (async () => {
        const tokens = await getTokens(this.resolveDatabase());
        return tokens?.scope ?? null;
      });
    this.computeRetryDelay = opts.computeRetryDelay ?? nextRetryDelay;
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
   * S13: anonymous-user enqueue gate. If the user is not signed in (signed
   * out, or never signed in), the op is silently dropped
   * rather than written to Dexie. Without this gate every Dexie mutation
   * accumulated a row in `syncQueue` that flush() then rejected with
   * `'No access token'`, polluting the dev-mode error log and producing
   * a non-trivial backlog the user would have to clear by signing in.
   * Per the S10 followup, gating at the queue boundary is cleaner than
   * gating each call site.
   *
   * Spec 016 FR-009: the gate is "a sign-in is stored", not a fresh access
   * token — getting one may wait for a renewal (even a pop-up), and a tab
   * closed meanwhile lost the op. `flush` gets (and renews) the token.
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
    if (!(await this.isSignedIn())) {
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
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
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
    this.flushInFlight = this.exclusive(() => this.runFlush()).finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  /**
   * Check Drive for changes made on another device and merge them in (spec
   * 016, FR-001). Runs the same cycle as a push, under the same lock, with
   * the same token renewal: a stale stored sign-in is renewed first, and a
   * 401 renews once and repeats the request. Uploads in the same cycle when
   * the remote lacks rows this device has. Concurrent calls share one run.
   * Never throws — the outcome says what happened.
   */
  async pullNow(): Promise<PullResult> {
    if (this.pullInFlight) return this.pullInFlight;
    this.pullInFlight = this.exclusive(() => this.runPull()).finally(() => {
      this.pullInFlight = null;
    });
    return this.pullInFlight;
  }

  /** Run `task` once every earlier lock holder has settled. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lockTail.then(task, task);
    this.lockTail = run.catch(() => undefined);
    return run;
  }

  private async runPull(): Promise<PullResult> {
    let hasCalendarScope = false;
    try {
      const scopes = (await this.getGrantedScopes())?.split(' ') ?? [];
      hasCalendarScope = scopes.includes(SCOPE_CALENDAR_APP_CREATED);
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return { outcome: 'offline', conflictCount: 0, hasCalendarScope };
      }
      if (!scopes.includes(SCOPE_DRIVE_APPDATA)) {
        return { outcome: 'no-scope', conflictCount: 0, hasCalendarScope };
      }
      const token = await this.getAccessToken();
      if (!token) return { outcome: 'no-token', conflictCount: 0, hasCalendarScope };

      const database = this.resolveDatabase();
      const withAuthRetry = this.makeAuthRetry(token);
      const result = await withAuthRetry((t) => this.syncCycle(database, t, { push: false }));
      if (this.updateRequired) {
        // A supported file again: let the held-back pushes go.
        this.updateRequired = false;
        this.setStatus('idle');
        this.scheduleFlush();
      }
      return { ...result, hasCalendarScope };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (err instanceof RemoteSchemaNewerError) {
        this.markUpdateRequired(err);
        return { outcome: 'update-required', conflictCount: 0, hasCalendarScope, error };
      }
      console.warn('[SyncManager] pull failed:', err);
      return { outcome: 'failed', conflictCount: 0, hasCalendarScope, error };
    }
  }

  /**
   * Spec 014: a 401 renews the sign-in at most once per run and repeats that
   * request once with the renewed token; later requests in the run use it
   * too. A second 401 falls through to the caller's error handling.
   */
  private makeAuthRetry(initialToken: string) {
    let accessToken = initialToken;
    let renewal: Promise<string | null> | null = null;
    return async <T>(call: (token: string) => Promise<T>): Promise<T> => {
      try {
        return await call(accessToken);
      } catch (err) {
        if (!(err instanceof CalendarAuthError || err instanceof DriveAuthError)) throw err;
        // A renewal that itself throws must not replace the 401 the user
        // can act on; it counts as "not renewed".
        renewal ??= this.forceRenewAccessToken().catch((renewErr: unknown) => {
          console.error('[SyncManager] renewing the sign-in failed:', renewErr);
          return null;
        });
        const renewed = await renewal;
        if (!renewed || renewed === accessToken) {
          console.warn('[SyncManager] 401 not retried — the sign-in was not renewed');
          throw err;
        }
        accessToken = renewed;
        return call(renewed);
      }
    };
  }

  /**
   * Spec 009 — the per-op handling below catches what a Drive or Calendar
   * call throws, but not what happens around it (reading the queue, the
   * token, deleting or rescheduling a row). Such an exception used to leave
   * the indicator at "syncing" with no retry armed until unrelated activity.
   */
  private async runFlush(): Promise<void> {
    try {
      await this.runFlushOnce();
      this.consecutiveFlushFailures = 0;
    } catch (err) {
      this.consecutiveFlushFailures += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SyncManager] flush failed:', err);
      this.setStatus('error', message);
      try {
        await this.armRetry(this.resolveDatabase(), this.consecutiveFlushFailures);
      } catch (retryErr) {
        console.error('[SyncManager] could not arm a retry:', retryErr);
      }
    }
  }

  private async runFlushOnce(): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setStatus('offline');
      return;
    }

    const database = this.resolveDatabase();
    const rows = this.runnable(await getReadySyncQueueRows(database));
    if (rows.length === 0) {
      this.settleStatus();
      return;
    }

    // Defensive scope check — bail out cleanly if the user hasn't granted
    // the Drive App Folder scope. Surfaces an error state but doesn't loop.
    const scope = await this.getGrantedScopes();
    if (!scope || !scope.split(' ').includes(SCOPE_DRIVE_APPDATA)) {
      this.setStatus('error', 'Drive scope not granted');
      return;
    }

    const initialToken = await this.getAccessToken();
    if (!initialToken) {
      this.setStatus('error', 'No access token');
      return;
    }

    // A second 401 falls through to the normal reschedule.
    const withAuthRetry = this.makeAuthRetry(initialToken);

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
        await withAuthRetry((token) => this.syncCycle(database, token, { push: true }));
        // All coalesced rows are cleared on a single successful push.
        for (const r of pushRows) {
          if (r.id !== undefined) {
            await deleteSyncQueueRow(database, r.id);
          }
        }
      } catch (err) {
        if (err instanceof RemoteSchemaNewerError) {
          // Nothing was uploaded. The rows stay exactly as they are — no
          // reschedule, no backoff — until a supported file is read again.
          this.markUpdateRequired(err);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          flushError = message;
          for (const r of pushRows) {
            if (r.id !== undefined) {
              const delay = this.computeRetryDelay(r.attempts ?? 0);
              await rescheduleSyncQueueRow(database, r.id, delay, message);
            }
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
            const delay = this.computeRetryDelay(r.attempts ?? 0);
            await rescheduleSyncQueueRow(database, r.id, delay, 'Calendar scope not granted');
          }
        }
      } else {
        for (const r of calendarRows) {
          try {
            await withAuthRetry((token) => this.dispatchCalendarOp(r, token, database));
            if (r.id !== undefined) {
              await deleteSyncQueueRow(database, r.id);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            flushError = flushError ?? msg;
            if (r.id !== undefined) {
              const delay = this.computeRetryDelay(r.attempts ?? 0);
              await rescheduleSyncQueueRow(database, r.id, delay, msg);
            }
          }
        }
      }
    }

    if (flushError) {
      // "Update the app" is the actionable message; a calendar error stays on its row.
      this.setStatus('error', this.updateRequired ? SYNC_UPDATE_REQUIRED : flushError);
      await this.armRetry(database);
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
    // Held-back pushes (update required) are excluded, or they would re-run
    // this flush every debounce interval.
    const remaining = this.runnable(await getReadySyncQueueRows(database));
    if (remaining.length > 0) {
      this.setStatus('syncing');
      this.scheduleFlush();
    } else {
      this.settleStatus();
    }
  }

  /** Queue rows a flush may run now — `pushDataJson` is held back while an update is required. */
  private runnable(rows: SyncQueueRow[]): SyncQueueRow[] {
    return this.updateRequired ? rows.filter((r) => r.op !== 'pushDataJson') : rows;
  }

  /** Status once nothing is left to run: idle, or the update-required error. */
  private settleStatus(): void {
    if (this.updateRequired) this.setStatus('error', SYNC_UPDATE_REQUIRED);
    else this.setStatus('idle');
  }

  private markUpdateRequired(err: RemoteSchemaNewerError): void {
    if (!this.updateRequired) {
      console.warn('[SyncManager] uploads paused — app update required:', err.message);
    }
    this.updateRequired = true;
    this.setStatus('error', SYNC_UPDATE_REQUIRED);
  }

  /**
   * Arm a single timer for the earliest `nextAttemptAt` still sitting in the
   * queue, so a failed flush retries itself instead of waiting for unrelated
   * user activity. Only one timer is ever pending; a later flush re-arms it.
   */
  private async armRetry(database: HourTrackDB, minAttempts = 0): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const pending = this.runnable(await database.syncQueue.toArray());
    if (pending.length === 0) return;
    const soonest = Math.min(...pending.map((r) => r.nextAttemptAt ?? 0));
    // Floor at the base delay: a row whose `nextAttemptAt` is already in the
    // past must not spin the loop. `minAttempts` raises the floor for repeat
    // failures that never got to reschedule their rows.
    const delay = Math.max(this.computeRetryDelay(minAttempts), soonest - Date.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush().catch(() => {
        /* status carries the error */
      });
    }, delay);
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
   * One sync cycle (spec 016 §2) — always called under the Drive lock.
   *
   *   1. Resolve `data.json`: the cached id's metadata, else `findFile`. A
   *      cached id that 404s is forgotten and looked up again (FR-007);
   *      only when nothing exists is the file created from local data.
   *   2. When the file's `version` differs from the remembered one (or none
   *      is remembered — e.g. a device that never pulled, FR-005): download,
   *      validate, LWW-merge with local, record conflicts, apply row-wise.
   *      A file in a newer format throws `RemoteSchemaNewerError` here,
   *      before anything is applied or uploaded (FR-008). Every path that
   *      finds an existing file (cached id, lookup, 404 → lookup) reaches it.
   *   3. Upload when `push` was asked for, or when the remote lacks rows this
   *      device has (fingerprint over every row store, FR-006). After a pull
   *      the upload is the merged snapshot; a row written locally since is
   *      covered by its own queued push.
   *   4. Remember the file id + the version after the LAST request.
   *
   * Drive has no compare-and-swap, so an upload landing between step 1 and
   * step 3 on another device can still be overwritten; that device restores
   * its rows at its next cycle (accepted in the spec).
   */
  private async syncCycle(
    database: HourTrackDB,
    accessToken: string,
    { push }: { push: boolean },
  ): Promise<CycleResult> {
    const drive = { accessToken, fetchImpl: this.fetchImpl };
    await pruneOldTombstones(database);

    const settings = await getSettings(database);
    const cachedId = settings?.driveDataFileId ?? null;
    let meta: DriveFileMeta | null = null;
    if (cachedId) {
      try {
        meta = await readFileMeta(cachedId, drive);
      } catch (err) {
        if (!(err instanceof DriveNotFoundError)) throw err;
        await updateSettings(database, { driveDataFileId: null, driveDataEtag: null });
      }
    }
    meta ??= await findFile(DATA_FILE_NAME, drive);

    if (!meta) {
      const local = await buildSnapshot(database);
      const created = await createJsonFile(DATA_FILE_NAME, local, appPropertiesOf(local), drive);
      await this.rememberRemote(database, created.fileId, created.version);
      return { outcome: 'created', conflictCount: 0 };
    }

    // A revision remembered for another file id says nothing about this one.
    const knownVersion = meta.id === cachedId ? settings?.driveDataEtag || null : null;
    const remoteChanged = !knownVersion || !meta.version || meta.version !== knownVersion;

    let snapshotToPush: DriveSnapshot | null = null;
    let remoteNeedsPush = false;
    let conflictCount = 0;
    if (remoteChanged) {
      const pulled = await readJsonFile<unknown>(meta.id, drive);
      // S31 (UR-31-6): validate BEFORE merging — a truncated / null-array
      // `data.json` throws `InvalidSnapshotError` (retryable) instead of
      // crashing `lwwMerge`, and nothing is uploaded over it.
      const validated = validatePulledSnapshot(pulled.data);
      const local = await buildSnapshot(database);
      // 001-cards-order-colors: a file written before `Card.position` existed
      // has ranks fabricated by the validator; they must not beat a rank the
      // user chose on this device.
      const { snapshot: merged, conflictsResolved } = lwwMerge(local, validated, {
        remoteRanksAreAuthoritative: snapshotCarriesCardRanks(pulled.data),
      });
      recordConflicts(conflictsResolved);
      // S29: row-wise LWW apply (NOT clear-and-rewrite) so a local write made
      // after `local` was built survives. Live reads show the pulled rows
      // without a reload (spec 006).
      await applySnapshot(merged, database, { mode: 'merge' });
      conflictCount = conflictsResolved.length;
      remoteNeedsPush = !sameRows(validated, merged);
      snapshotToPush = merged;
    }

    if (push || remoteNeedsPush) {
      const snapshot = snapshotToPush ?? (await buildSnapshot(database));
      const updated = await updateJsonFile(meta.id, snapshot, {
        ...drive,
        appProperties: appPropertiesOf(snapshot),
      });
      await this.rememberRemote(database, meta.id, updated.version);
    } else {
      await this.rememberRemote(database, meta.id, meta.version);
    }
    return { outcome: remoteChanged ? 'pulled' : 'unchanged', conflictCount };
  }

  private async rememberRemote(
    database: HourTrackDB,
    fileId: string,
    version: string,
  ): Promise<void> {
    await updateSettings(database, {
      driveDataFileId: fileId,
      driveDataEtag: version,
      lastSyncAt: new Date().toISOString(),
    });
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
