import type { Entry } from '@hourtrack/shared-types';

import { db as defaultDb, getAllEntries, type HourTrackDB } from '@/lib/db';

import {
  handleCreateCalendarEvent,
  handleUpdateCalendarEvent,
  type CalendarOpOptions,
} from '@/features/sync/handlers/calendarOps';

/**
 * Re-sync every entry to Google Calendar. Used by Settings → Calendar →
 * "Re-sync all entries" — the user's escape hatch when sync errors have
 * accumulated.
 *
 * S16b: this module is unchanged in code but now emits **time-bound** events
 * (not all-day) because `buildEvent` was rewritten to produce
 * `{ start: { dateTime, timeZone } }` payloads. "Re-sync All" is therefore the
 * user-facing path to push fresh time-bound events to Google Calendar after
 * the v1→v2 cutover.
 *
 * Important: any **orphan all-day events left behind in Google Calendar from
 * v1** are NOT cleaned up by resync — the Dexie v5 destructive migration in
 * S16 wiped the local DB that held those events' `googleEventId`s, so the app
 * no longer has a handle to delete them. The user has to delete those orphans
 * manually in Google Calendar (or ignore them). RestoreModal copy +
 * SMOKE_TEST.md surface this honestly.
 *
 * Behaviour modes:
 *   - `only-errored` (default) — visits entries with `syncStatus !== 'synced'`.
 *     This is the "repair" mode that consumes ~zero Calendar API budget when
 *     things are healthy.
 *   - `all` — visits EVERY entry. Forces a full re-render of titles + colors
 *     from the current local state, useful after schema or palette migrations.
 *
 * For each visited entry:
 *   - If `googleEventId` is null → calls `handleCreateCalendarEvent`
 *   - Otherwise → calls `handleUpdateCalendarEvent` (PATCH path)
 *
 * Throttle: Calendar API publishes a ~5 QPS per-user soft cap. We process
 * sequentially with a small (default 200ms) inter-call delay. This keeps us
 * well under the cap and avoids triggering 403 rateLimitExceeded responses
 * during long replays. Callers receive `(done, total)` progress via the
 * `onProgress` callback.
 *
 * Errors per entry are caught and counted; the runner does NOT abort on the
 * first failure (the user explicitly asked for a "repair" — partial progress
 * is better than no progress). The final summary includes the count.
 */

export type ResyncMode = 'only-errored' | 'all';

export interface RunResyncOptions extends CalendarOpOptions {
  mode?: ResyncMode;
  /**
   * Inter-call delay in ms. Default 200 (~5 QPS upper bound). Override to 0
   * in tests to keep the suite fast.
   */
  throttleMs?: number;
  onProgress?: (done: number, total: number) => void;
  /** Override `setTimeout` for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ResyncResult {
  total: number;
  succeeded: number;
  failed: number;
  /** First error encountered, for surfacing in a toast. */
  firstError?: string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isResyncTarget(entry: Entry, mode: ResyncMode): boolean {
  if (mode === 'all') return true;
  return entry.syncStatus !== 'synced';
}

export async function runResyncAll(opts: RunResyncOptions): Promise<ResyncResult> {
  const database: HourTrackDB = opts.database ?? defaultDb;
  const mode = opts.mode ?? 'only-errored';
  const throttle = opts.throttleMs ?? 200;
  const sleep = opts.sleep ?? defaultSleep;

  const allEntries = await getAllEntries(database);
  const targets = allEntries.filter((e) => isResyncTarget(e, mode));
  const total = targets.length;

  let succeeded = 0;
  let failed = 0;
  let firstError: string | undefined;

  opts.onProgress?.(0, total);

  for (let i = 0; i < targets.length; i += 1) {
    const entry = targets[i]!;
    try {
      if (entry.googleEventId == null) {
        await handleCreateCalendarEvent(entry.id, {
          accessToken: opts.accessToken,
          database,
          fetchImpl: opts.fetchImpl,
        });
      } else {
        await handleUpdateCalendarEvent(entry.id, {
          accessToken: opts.accessToken,
          database,
          fetchImpl: opts.fetchImpl,
        });
      }
      succeeded += 1;
    } catch (err) {
      failed += 1;
      if (!firstError) {
        firstError = err instanceof Error ? err.message : String(err);
      }
    }
    opts.onProgress?.(i + 1, total);
    if (throttle > 0 && i < targets.length - 1) {
      await sleep(throttle);
    }
  }

  return { total, succeeded, failed, firstError };
}
