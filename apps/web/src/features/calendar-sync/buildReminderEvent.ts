import { addMinutes, format, parseISO, set } from 'date-fns';

import type { Reminder } from '@hourtrack/shared-types';

import type { CalendarEventInput } from '@/lib/google/calendar';

/**
 * S28 — build a Google Calendar event payload for a reminder. Mirrors the
 * RFC3339 wall-clock discipline of `buildEvent.ts` (entries):
 *
 *   - The event is TIME-BOUND with a floating wall-clock `dateTime` (NO `Z`,
 *     NO offset) + an explicit IANA `timeZone`, so Google interprets the
 *     wall-clock against that zone. NEVER `.toISOString()` here — that stamps
 *     `Z` (UTC) and Google reinterprets it against `timeZone`, causing silent
 *     ±Nh drift in non-UTC zones. `buildReminderEvent.test.ts` locks this.
 *   - Duration is a fixed 15 minutes. A reminder is a point-in-time nudge, not
 *     a work session; 15 minutes gives it a visible slot without implying a
 *     block of time. Unlike `buildEvent`, a late-day reminder is allowed to
 *     roll its end past midnight (date-fns `addMinutes` handles the day
 *     rollover) — reminders have no `startMinutes + durationMin <= 1440`
 *     invariant.
 *   - Summary: `🔔 {text}` (the bell emoji distinguishes it at a glance from
 *     entry events, which are `{card} | {time} | {amount}`).
 *   - `reminders.overrides`: one `popup` at minute 0. This is free upside if
 *     the user's phone notifies from the HourTrack calendar; it is NOT an
 *     acceptance criterion and its failure is NOT a bug (S28 spec Notes).
 *
 * Color: a fixed `'5'` (Banana / yellow) so reminder events read as a distinct
 * category from the per-card-colored entry events.
 */

const RFC3339_LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm:ss" as const;
const REMINDER_DURATION_MIN = 15 as const;
/** Google colorId '5' == "Banana" (yellow). Distinct from entry event colors. */
const REMINDER_COLOR_ID = '5' as const;

/** Compose a local Date from a `YYYY-MM-DD` date + minutes-since-midnight. */
function wallClockDate(dateLocal: string, minutesSinceMidnight: number): Date {
  const hours = Math.floor(minutesSinceMidnight / 60);
  const minutes = minutesSinceMidnight % 60;
  return set(parseISO(dateLocal), { hours, minutes, seconds: 0, milliseconds: 0 });
}

export function buildReminderEvent(reminder: Reminder): CalendarEventInput {
  if (
    !Number.isInteger(reminder.dueMinutes) ||
    reminder.dueMinutes < 0 ||
    reminder.dueMinutes > 1439
  ) {
    throw new Error(
      `buildReminderEvent: invalid dueMinutes (${String(reminder.dueMinutes)}) on reminder ${reminder.id}`,
    );
  }

  const text = reminder.text.trim();
  const summary = `🔔 ${text}`;

  const startDate = wallClockDate(reminder.dueDate, reminder.dueMinutes);
  const endDate = addMinutes(startDate, REMINDER_DURATION_MIN);
  const startDateTime = format(startDate, RFC3339_LOCAL_FORMAT);
  const endDateTime = format(endDate, RFC3339_LOCAL_FORMAT);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    summary,
    start: { dateTime: startDateTime, timeZone },
    end: { dateTime: endDateTime, timeZone },
    description: text,
    colorId: REMINDER_COLOR_ID,
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 0 }],
    },
  };
}
