import { db as defaultDb, getSettings, updateSettings, type HourTrackDB } from '@/lib/db';
import { createCalendar, listCalendars, CalendarNotFoundError } from '@/lib/google/calendar';

/**
 * Ensure the user has a "HourTrack" calendar and return its id.
 *
 * Resolution order (per sprint spec task #2):
 *   1. If `Settings.hourtrackCalendarId` is cached, return it directly (fast
 *      path — no Google API call).
 *   2. List app-created calendars and look for one whose `summary === 'HourTrack'`
 *      (the canonical name). If found, cache + return.
 *   3. Otherwise, create a new calendar with `summary: 'HourTrack'`, cache +
 *      return.
 *
 * The function is idempotent — running it twice yields the same id without
 * creating a second calendar (steps 1-2 catch the existing one).
 *
 * The `forceRecreate` option bypasses the local cache + the listCalendars
 * step and creates fresh. Used by the handler layer when `insertEvent`
 * returned 404 (user deleted the calendar Google-side).
 */

export const HOURTRACK_CALENDAR_SUMMARY = 'HourTrack' as const;

export interface EnsureCalendarOptions {
  accessToken: string;
  database?: HourTrackDB;
  fetchImpl?: typeof fetch;
  /**
   * Skip the cached id + skip listCalendars; always create a new calendar.
   * Used after a 404 from insertEvent indicates the calendar was deleted.
   */
  forceRecreate?: boolean;
}

export interface EnsureCalendarResult {
  calendarId: string;
  /** Whether a new calendar was created (vs reused from cache or list). */
  created: boolean;
}

export async function ensureCalendar(opts: EnsureCalendarOptions): Promise<EnsureCalendarResult> {
  const database = opts.database ?? defaultDb;

  if (!opts.forceRecreate) {
    // 1. Cached id — fastest path. Skip the list-calendars round-trip.
    const settings = await getSettings(database);
    if (settings?.hourtrackCalendarId) {
      return { calendarId: settings.hourtrackCalendarId, created: false };
    }

    // 2. List existing app-created calendars. Under
    // `calendar.app.created` scope this returns only calendars THIS app
    // created — safe to filter by summary.
    try {
      const calendars = await listCalendars({
        accessToken: opts.accessToken,
        fetchImpl: opts.fetchImpl,
      });
      const existing = calendars.find((c) => c.summary === HOURTRACK_CALENDAR_SUMMARY);
      if (existing) {
        await updateSettings(database, { hourtrackCalendarId: existing.id });
        return { calendarId: existing.id, created: false };
      }
    } catch (err) {
      // If list fails (e.g. transient 5xx), fall through to the create
      // path — the worst case is a duplicate "HourTrack" calendar, which
      // is much better UX than blocking the sync entirely. `forceRecreate`
      // intentionally takes the same code path.
      if (err instanceof CalendarNotFoundError) {
        // Not expected from listCalendars, but bail safely.
        throw err;
      }
      // Other errors fall through to create.
      console.warn('[ensureCalendar] listCalendars failed; will create:', err);
    }
  }

  // 3. Create fresh.
  const created = await createCalendar(
    { summary: HOURTRACK_CALENDAR_SUMMARY },
    { accessToken: opts.accessToken, fetchImpl: opts.fetchImpl },
  );
  await updateSettings(database, { hourtrackCalendarId: created.id });
  return { calendarId: created.id, created: true };
}
