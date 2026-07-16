import type { Card, Entry, Reminder } from '@hourtrack/shared-types';

import {
  db as defaultDb,
  getCardById,
  getEntriesByCardId,
  getReminderById,
  updateEntry,
  updateReminder,
  type HourTrackDB,
} from '@/lib/db';
import {
  CalendarApiError,
  CalendarNotFoundError,
  deleteEvent,
  insertEvent,
  patchEvent,
} from '@/lib/google/calendar';

import { buildEvent } from '@/features/calendar-sync/buildEvent';
import { buildReminderEvent } from '@/features/calendar-sync/buildReminderEvent';
import { ensureCalendar } from '@/features/calendar-sync/ensureCalendar';

/**
 * Calendar operation handlers consumed by the SyncManager.
 *
 * Each handler is async + idempotent, takes the same options bag
 * (`accessToken`, `database`, `fetchImpl`), and is responsible for:
 *   - resolving the HourTrack calendar id (via `ensureCalendar`)
 *   - mapping the queued op into one or more Calendar API calls
 *   - persisting `syncStatus` / `syncError` / `googleEventId` back to Dexie
 *
 * Concurrency on bulk ops uses a small (3-in-flight) Promise pool — Calendar
 * API's published per-user QPS is ~5 (well below the project-wide quota).
 * Three concurrent requests stays comfortably under that envelope while
 * still completing a 50-event bulk PATCH in ~17 batches instead of 50.
 *
 * Error policy:
 *   - `CalendarNotFoundError` on a 404/410 from `insertEvent` indicates the
 *     calendar itself was deleted Google-side. The handler re-runs
 *     `ensureCalendar({ forceRecreate: true })` and retries the insert
 *     ONCE. A second failure surfaces to the SyncManager as a retryable
 *     error.
 *   - `CalendarNotFoundError` from `patchEvent` / `deleteEvent` is treated
 *     as "the event is already gone" — the handler marks the entry's
 *     `googleEventId = null` (PATCH path only — if the event was deleted
 *     externally, we drop the local id so the next mutation re-creates the
 *     event) and resolves successfully.
 *   - All other errors propagate; SyncManager applies the standard backoff
 *     policy.
 */

export interface CalendarOpOptions {
  accessToken: string;
  database?: HourTrackDB;
  fetchImpl?: typeof fetch;
}

/**
 * Bound payloads stored in `SyncQueueRow.payload` for the new calendar ops.
 * These shapes are validated by the SyncManager dispatch layer; the handlers
 * assume well-formed input.
 */
export interface DeleteCalendarEventPayload {
  googleEventId: string;
}

export interface BulkUpdateCardEventsPayload {
  cardId: string;
}

const BULK_CONCURRENCY = 3 as const;

async function withDb<T>(opts: CalendarOpOptions, fn: (db: HourTrackDB) => Promise<T>): Promise<T> {
  return fn(opts.database ?? defaultDb);
}

/**
 * Mark an entry as `synced` (or `error`) after a calendar op completed (or
 * failed). The write is best-effort: if the entry row was deleted between
 * the API call and this stamp, we silently swallow because the user already
 * accepted the divergence.
 */
async function stampEntry(
  db: HourTrackDB,
  entryId: string,
  patch: Partial<Pick<Entry, 'googleEventId' | 'syncStatus' | 'syncError'>>,
): Promise<void> {
  try {
    await updateEntry(db, entryId, patch);
  } catch (err) {
    // Likely "entry not found" — entry was deleted between the calendar
    // call and this stamp. Tombstone propagation handles the cascade
    // separately; nothing to do here.
    console.warn('[calendarOps] stampEntry skipped:', (err as Error).message);
  }
}

/**
 * Run an `insertEvent` call, recovering from `CalendarNotFoundError` (which
 * means the calendar itself was deleted) by recreating the calendar and
 * retrying ONCE.
 */
async function insertEventWithRecovery(
  calendarId: string,
  payload: ReturnType<typeof buildEvent>,
  opts: CalendarOpOptions,
): Promise<{ event: Awaited<ReturnType<typeof insertEvent>>; calendarId: string }> {
  try {
    const event = await insertEvent(calendarId, payload, {
      accessToken: opts.accessToken,
      fetchImpl: opts.fetchImpl,
    });
    return { event, calendarId };
  } catch (err) {
    if (err instanceof CalendarNotFoundError) {
      // The calendar itself was deleted Google-side. Recreate it then
      // retry the insert exactly once.
      const recovered = await ensureCalendar({
        accessToken: opts.accessToken,
        database: opts.database,
        fetchImpl: opts.fetchImpl,
        forceRecreate: true,
      });
      const event = await insertEvent(recovered.calendarId, payload, {
        accessToken: opts.accessToken,
        fetchImpl: opts.fetchImpl,
      });
      return { event, calendarId: recovered.calendarId };
    }
    throw err;
  }
}

/**
 * Build event payload for the given entry. Returns null when the entry was
 * deleted or its card was hard-deleted — caller treats both as "skip".
 */
async function resolveEventInputs(
  db: HourTrackDB,
  entryId: string,
): Promise<{ entry: Entry; card: Card; allCardEntries: Entry[] } | null> {
  const entry = await db.entries.get(entryId);
  if (!entry) return null;
  const card = await getCardById(db, entry.cardId);
  if (!card) return null;
  const allCardEntries = await getEntriesByCardId(db, card.id);
  return { entry, card, allCardEntries };
}

/**
 * Create a Calendar event for an entry. Stamps `googleEventId` + flips
 * `syncStatus` to `'synced'` (or `'error'` on failure).
 */
export async function handleCreateCalendarEvent(
  entryId: string,
  opts: CalendarOpOptions,
): Promise<void> {
  return withDb(opts, async (db) => {
    const inputs = await resolveEventInputs(db, entryId);
    if (!inputs) return; // entry/card gone — nothing to sync

    const { entry, card, allCardEntries } = inputs;
    const payload = buildEvent(entry, card, allCardEntries);

    const ensured = await ensureCalendar({
      accessToken: opts.accessToken,
      database: db,
      fetchImpl: opts.fetchImpl,
    });

    try {
      const { event } = await insertEventWithRecovery(ensured.calendarId, payload, {
        ...opts,
        database: db,
      });
      await stampEntry(db, entryId, {
        googleEventId: event.id,
        syncStatus: 'synced',
        syncError: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await stampEntry(db, entryId, { syncStatus: 'error', syncError: msg });
      throw err;
    }
  });
}

/**
 * Update an existing Calendar event for an entry. If the entry has no
 * `googleEventId` yet (e.g. an offline edit before the original create
 * synced), fall through to `handleCreateCalendarEvent` so the user's edit
 * still propagates.
 */
export async function handleUpdateCalendarEvent(
  entryId: string,
  opts: CalendarOpOptions,
): Promise<void> {
  return withDb(opts, async (db) => {
    const inputs = await resolveEventInputs(db, entryId);
    if (!inputs) return;

    const { entry, card, allCardEntries } = inputs;
    if (!entry.googleEventId) {
      // No remote event yet — convert update into create.
      await handleCreateCalendarEvent(entryId, opts);
      return;
    }
    const payload = buildEvent(entry, card, allCardEntries);

    const ensured = await ensureCalendar({
      accessToken: opts.accessToken,
      database: db,
      fetchImpl: opts.fetchImpl,
    });

    try {
      await patchEvent(ensured.calendarId, entry.googleEventId, payload, {
        accessToken: opts.accessToken,
        fetchImpl: opts.fetchImpl,
      });
      await stampEntry(db, entryId, { syncStatus: 'synced', syncError: null });
    } catch (err) {
      if (err instanceof CalendarNotFoundError) {
        // Event was deleted externally. Drop the stale id; the next user
        // edit will re-create. We do NOT auto-recreate here because the
        // user may have explicitly deleted the event in Google Calendar
        // — surfacing as "synced" with id=null avoids resurrecting it.
        await stampEntry(db, entryId, {
          googleEventId: null,
          syncStatus: 'synced',
          syncError: null,
        });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      await stampEntry(db, entryId, { syncStatus: 'error', syncError: msg });
      throw err;
    }
  });
}

/**
 * Delete a Calendar event by id. The caller has ALREADY removed the entry
 * row from Dexie (see `useEntries.ts` delete flow) and written a tombstone
 * — this handler only owns the remote-event cascade.
 *
 * Failure here is non-blocking for the user: the entry is gone locally, the
 * tombstone propagates the delete to other devices via Drive sync, and the
 * SyncManager retries this op until the remote event is also gone (or
 * Google says it's already gone, which counts as success — idempotent).
 */
export async function handleDeleteCalendarEvent(
  googleEventId: string,
  opts: CalendarOpOptions,
): Promise<void> {
  // Resolve the calendar id from settings WITHOUT calling ensureCalendar's
  // listCalendars/create paths — by the time a delete fires, the user has
  // either previously synced (so the id is cached) OR they disconnected
  // entirely (in which case there's no remote event to clean up).
  return withDb(opts, async (db) => {
    const settings = await db.settings.get('current');
    const calendarId = settings?.hourtrackCalendarId ?? null;
    if (!calendarId) {
      // User disconnected calendar — drop the op as a no-op. The Drive
      // tombstone already conveys the delete to other devices.
      return;
    }
    // CalendarNotFoundError is already mapped to a clean resolve inside
    // `deleteEvent` itself; any other error bubbles up to SyncManager retry.
    await deleteEvent(calendarId, googleEventId, {
      accessToken: opts.accessToken,
      fetchImpl: opts.fetchImpl,
    });
  });
}

/**
 * Bulk-PATCH every synced event belonging to a card. Used when the card's
 * name or color changes — the event title and colorId must follow.
 *
 * Iterates the card's entries with a 3-in-flight concurrency pool. Per-entry
 * errors are collected; if ANY entry fails, the handler throws the first
 * error so SyncManager retries the whole op. Successfully-patched entries
 * are already stamped `synced` so the retry is largely a no-op for them.
 *
 * The optional `onProgress` callback receives `(done, total)` after each
 * entry — wired by the future `CalendarSection` "Re-sync all entries"
 * progress modal. SyncManager-driven calls pass undefined.
 */
export interface BulkOpProgress {
  onProgress?: (done: number, total: number) => void;
}

export async function handleBulkUpdateCardEvents(
  cardId: string,
  opts: CalendarOpOptions & BulkOpProgress,
): Promise<void> {
  return withDb(opts, async (db) => {
    const card = await getCardById(db, cardId);
    if (!card) return; // Card was hard-deleted; tombstone handles cascade.
    const entries = await getEntriesByCardId(db, cardId);
    const targets = entries.filter((e) => e.googleEventId != null);
    if (targets.length === 0) {
      opts.onProgress?.(0, 0);
      return;
    }

    // Branch on archive status:
    //   - active card  → PATCH every event so the new title/color renders
    //   - archived card → DELETE every event (cascade-on-archive per
    //     PROJECT_PLAN §3 "Card deletion: Soft delete" + spec Notes #6:
    //     "cascade delete is one-way (app → Calendar)").
    // The handler stays one op (not two) because Drive + Calendar must
    // converge regardless of the trigger; the user perceives one action.
    const mode: 'patch' | 'delete' = card.isArchived ? 'delete' : 'patch';

    // For delete-mode we do NOT need ensureCalendar to create a fresh
    // calendar — if the user never had one, there's nothing to delete.
    // Read the cached id directly and bail out early when absent.
    let calendarId: string;
    if (mode === 'delete') {
      const settings = await db.settings.get('current');
      const cached = settings?.hourtrackCalendarId ?? null;
      if (!cached) {
        // No remote calendar exists → nothing to clean up. Drop the locally
        // stored googleEventIds so a future restore-from-archive starts
        // fresh.
        for (const entry of targets) {
          await stampEntry(db, entry.id, {
            googleEventId: null,
            syncStatus: 'synced',
            syncError: null,
          });
        }
        opts.onProgress?.(targets.length, targets.length);
        return;
      }
      calendarId = cached;
    } else {
      const ensured = await ensureCalendar({
        accessToken: opts.accessToken,
        database: db,
        fetchImpl: opts.fetchImpl,
      });
      calendarId = ensured.calendarId;
    }

    let cursor = 0;
    let done = 0;
    let firstError: unknown = null;

    const runOne = async (entry: Entry): Promise<void> => {
      try {
        if (mode === 'patch') {
          const payload = buildEvent(entry, card, entries);
          await patchEvent(calendarId, entry.googleEventId!, payload, {
            accessToken: opts.accessToken,
            fetchImpl: opts.fetchImpl,
          });
          await stampEntry(db, entry.id, {
            syncStatus: 'synced',
            syncError: null,
          });
        } else {
          await deleteEvent(calendarId, entry.googleEventId!, {
            accessToken: opts.accessToken,
            fetchImpl: opts.fetchImpl,
          });
          // After delete succeeds, drop the local id so restore-from-
          // archive doesn't try to patch a non-existent event.
          await stampEntry(db, entry.id, {
            googleEventId: null,
            syncStatus: 'synced',
            syncError: null,
          });
        }
      } catch (err) {
        if (err instanceof CalendarNotFoundError) {
          // Event vanished externally — drop the id but don't fail the bulk.
          await stampEntry(db, entry.id, {
            googleEventId: null,
            syncStatus: 'synced',
            syncError: null,
          });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        await stampEntry(db, entry.id, { syncStatus: 'error', syncError: msg });
        if (!firstError) firstError = err;
      } finally {
        done += 1;
        opts.onProgress?.(done, targets.length);
      }
    };

    // Three workers pull from a shared cursor. When the cursor reaches the
    // end, each worker exits, and `Promise.all` resolves once all three are
    // done. This is the simplest concurrency-limited pool that doesn't pull
    // in a dependency.
    const workers: Promise<void>[] = [];
    const N = Math.min(BULK_CONCURRENCY, targets.length);
    for (let i = 0; i < N; i += 1) {
      workers.push(
        (async () => {
          while (cursor < targets.length) {
            const idx = cursor;
            cursor += 1;
            await runOne(targets[idx]!);
          }
        })(),
      );
    }
    await Promise.all(workers);
    if (firstError) throw firstError;
  });
}

// ---------------------------------------------------------------------------
// Reminder calendar ops (S28)
// ---------------------------------------------------------------------------

/**
 * Best-effort stamp of a reminder's `googleEventId` / `syncStatus` /
 * `syncError` after a calendar op. Swallows "reminder not found" — the row may
 * have been deleted between the API call and this stamp; the tombstone cascade
 * handles that separately.
 */
async function stampReminder(
  db: HourTrackDB,
  reminderId: string,
  patch: Partial<Pick<Reminder, 'googleEventId' | 'syncStatus' | 'syncError'>>,
): Promise<void> {
  try {
    await updateReminder(db, reminderId, patch);
  } catch (err) {
    console.warn('[calendarOps] stampReminder skipped:', (err as Error).message);
  }
}

/**
 * Create a Calendar event for a reminder. Stamps `googleEventId` + flips
 * `syncStatus` to `'synced'` (or `'error'` on failure). Mirrors
 * `handleCreateCalendarEvent` but uses `buildReminderEvent`.
 */
export async function handleCreateReminderEvent(
  reminderId: string,
  opts: CalendarOpOptions,
): Promise<void> {
  return withDb(opts, async (db) => {
    const reminder = await getReminderById(db, reminderId);
    if (!reminder) return; // reminder gone — nothing to sync
    // A done reminder that synced its delete before this create drained: the
    // create is stale, skip it (the delete op — enqueued after — will clean up
    // if an event id ever lands). Guard keeps us from resurrecting an event
    // the user already dismissed.
    if (reminder.doneAt !== null) return;

    const payload = buildReminderEvent(reminder);
    const ensured = await ensureCalendar({
      accessToken: opts.accessToken,
      database: db,
      fetchImpl: opts.fetchImpl,
    });

    try {
      const { event } = await insertEventWithRecovery(ensured.calendarId, payload, {
        ...opts,
        database: db,
      });
      await stampReminder(db, reminderId, {
        googleEventId: event.id,
        syncStatus: 'synced',
        syncError: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await stampReminder(db, reminderId, { syncStatus: 'error', syncError: msg });
      throw err;
    }
  });
}

/**
 * Update an existing Calendar event for a reminder (text/date/time edit). If
 * the reminder has no `googleEventId` yet (offline edit before the create
 * synced), fall through to a create so the edit still propagates. Mirrors
 * `handleUpdateCalendarEvent`.
 */
export async function handleUpdateReminderEvent(
  reminderId: string,
  opts: CalendarOpOptions,
): Promise<void> {
  return withDb(opts, async (db) => {
    const reminder = await getReminderById(db, reminderId);
    if (!reminder) return;
    if (!reminder.googleEventId) {
      await handleCreateReminderEvent(reminderId, opts);
      return;
    }
    const payload = buildReminderEvent(reminder);
    const ensured = await ensureCalendar({
      accessToken: opts.accessToken,
      database: db,
      fetchImpl: opts.fetchImpl,
    });

    try {
      await patchEvent(ensured.calendarId, reminder.googleEventId, payload, {
        accessToken: opts.accessToken,
        fetchImpl: opts.fetchImpl,
      });
      await stampReminder(db, reminderId, { syncStatus: 'synced', syncError: null });
    } catch (err) {
      if (err instanceof CalendarNotFoundError) {
        // Event was deleted externally. Drop the stale id; the next edit will
        // re-create. Do NOT auto-recreate — the user may have deleted it.
        await stampReminder(db, reminderId, {
          googleEventId: null,
          syncStatus: 'synced',
          syncError: null,
        });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      await stampReminder(db, reminderId, { syncStatus: 'error', syncError: msg });
      throw err;
    }
  });
}

/**
 * Delete a reminder's Calendar event by id. The reminder row has ALREADY been
 * removed from Dexie (delete flow) OR marked done (done-before-due flow) by the
 * time this fires; the handler only owns the remote-event cascade. Identical
 * semantics to `handleDeleteCalendarEvent` (entries) — a done/deleted reminder
 * whose due time is in the future MUST NOT leave a stale event behind.
 */
export async function handleDeleteReminderEvent(
  googleEventId: string,
  opts: CalendarOpOptions,
): Promise<void> {
  return handleDeleteCalendarEvent(googleEventId, opts);
}

/**
 * Re-export the error classes so SyncManager callers can `instanceof`-narrow
 * without importing `@/lib/google/calendar` directly. Keeps the handler
 * module the single import surface for "calendar work."
 */
export { CalendarApiError, CalendarNotFoundError };
