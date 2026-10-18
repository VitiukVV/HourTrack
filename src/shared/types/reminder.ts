import type { SyncStatus } from './entry';

/**
 * Reminder -- a dated, free-text note the user wants surfaced at a specific
 * local date + time ("4 серпня 09:00 — Забрати кошти в Марі за липень").
 * Introduced in S28 alongside Dexie v8 / DriveSnapshot v5.
 *
 * Delivery surfaces (S28 scope, narrowed by the user 2026-07-12):
 *   1. In-app — a due-reminders banner on app open + a while-open toast.
 *   2. A Google Calendar event at the due datetime via the existing sync
 *      queue (see `features/calendar-sync/buildReminderEvent.ts`).
 * There is NO phone-shade / Notification API / Web Push delivery: the calendar
 * event's popup override is free upside, not a requirement.
 *
 * Date/time conventions mirror `Entry`:
 *   - `dueDate` is a LOCAL calendar date `YYYY-MM-DD` (produced by
 *     `formatLocalDate`, never `toISOString().slice(0,10)` — timezone trap).
 *   - `dueMinutes` is minutes-since-local-midnight, integer in `[0, 1439]`.
 * "Due" is therefore `dueDate + dueMinutes <= now` evaluated in local terms.
 */
export interface Reminder {
  /** uuid v4 generated client-side. */
  id: string;
  /** Free-text body shown in the bell list, banner, toast, and event title. */
  text: string;
  /**
   * Local calendar date the reminder is due, as `YYYY-MM-DD`. Produced by
   * `formatLocalDate(date)` — NEVER by `toISOString().slice(0,10)`.
   */
  dueDate: string;
  /** Time of day the reminder is due, minutes since local midnight `[0, 1439]`. */
  dueMinutes: number;
  /**
   * ISO timestamp the reminder was marked done, or `null` while still open.
   * A done reminder is dropped from the bell badge, banner, and scheduler.
   */
  doneAt: string | null;
  /** Google Calendar event id. Null until the create op syncs. */
  googleEventId: string | null;
  /** Reflects whether the Calendar event has been written (mirrors `Entry`). */
  syncStatus: SyncStatus;
  /** Last calendar-sync error message if `syncStatus === 'error'`, else null. */
  syncError: string | null;
  /**
   * ISO timestamp the while-open scheduler last fired a toast for this
   * reminder, or `null` if it never has. Prevents toast spam across the 60s
   * scheduler tick and multiple tabs — a per-reminder stamp, not per-device
   * (an accepted trade-off for a single-user app; see S28 spec Notes).
   */
  notifiedAt: string | null;
  /** ISO timestamp at creation. */
  createdAt: string;
  /** ISO timestamp of the most recent write. Drives Drive LWW merge. */
  updatedAt: string;
}
