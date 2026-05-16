import { addMinutes, format, parseISO, set } from 'date-fns';

import type { Card, Entry } from '@hourtrack/shared-types';
import { earningsForEntry, formatDuration } from '@hourtrack/shared-utils';

import { GOOGLE_CALENDAR_COLOR_MAP } from '@/lib/colors';

import type { CalendarEventInput } from '@/lib/google/calendar';

/**
 * Build a Google Calendar event payload from a HourTrack Entry + its Card +
 * the full per-card entry set in scope (needed by `earningsForEntry` for
 * fixed-rate proportional split).
 *
 * Title format (per PROJECT_PLAN.md §9.2 + req #22):
 *   `{cardName} | {H}H {M}M | {amount} EUR`
 *
 * The spec example `Raquel | 2H 45M | 36 EUR` rounds earnings to integer EUR
 * in the title for visual brevity. The description still shows the
 * full two-decimal value so the user can audit the math. Documented here so
 * downstream code (S13 onboarding hints, future export formats) doesn't
 * accidentally reinvent rounding rules.
 *
 * S16b: time-bound (NOT all-day). The start dateTime is composed as
 *   `${entry.date}T${HH}:${MM}:00`
 * — a floating wall-clock RFC3339 string with NO trailing `Z` and NO `±HH:MM`
 * offset. `timeZone` carries the IANA zone name so Google interprets the
 * wall-clock against that zone (the third RFC3339 form Calendar accepts).
 *
 * NEVER use `.toISOString()` here: it stamps `Z` (UTC), and Google then
 * reinterprets the UTC instant against the explicit `timeZone` field — the
 * result is silent ±Nh drift bugs that only surface in non-UTC user zones.
 * Tests in `buildEvent.test.ts` assert `!start.dateTime.endsWith('Z')` and
 * `!start.dateTime.includes('+')` to lock this contract in.
 *
 * Description rate-line logic (PROJECT_PLAN.md §9.2):
 *   - hourly + no custom payment → `{hourlyRate} EUR/h`
 *   - fixed  + no custom payment → `Fixed total: {fixedTotal} EUR (proportional split)`
 *   - any    + custom payment    → `Custom payment`
 *
 * Color: `GOOGLE_CALENDAR_COLOR_MAP[card.color]`. The map is exhaustive over
 * `CARD_COLORS` (enforced by `colors.test.ts`). One known collision: `#0F172A`
 * (slate) → `'8'` (graphite, also used by `#78716C` stone). Documented in
 * `lib/colors.ts`.
 */

const RFC3339_LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm:ss" as const;

/**
 * Compose an RFC3339 floating wall-clock string from a `YYYY-MM-DD` date and
 * minutes-since-midnight. Uses `date-fns/format` with the literal `'T'`
 * separator so we never call `.toISOString()` (which would emit `Z`).
 */
function formatWallClock(dateLocal: string, minutesSinceMidnight: number): string {
  const hours = Math.floor(minutesSinceMidnight / 60);
  const minutes = minutesSinceMidnight % 60;
  const base = set(parseISO(dateLocal), {
    hours,
    minutes,
    seconds: 0,
    milliseconds: 0,
  });
  return format(base, RFC3339_LOCAL_FORMAT);
}

/**
 * Compose an end wall-clock by adding `durationMin` minutes to the
 * start wall-clock. Done in local-Date space (no UTC round-trip) so a
 * `startMinutes: 1380, durationMin: 59` entry lands at `T23:59:00` on the
 * same day with no overflow.
 */
function formatEndWallClock(dateLocal: string, startMinutes: number, durationMin: number): string {
  const hours = Math.floor(startMinutes / 60);
  const minutes = startMinutes % 60;
  const startDate = set(parseISO(dateLocal), {
    hours,
    minutes,
    seconds: 0,
    milliseconds: 0,
  });
  const endDate = addMinutes(startDate, durationMin);
  return format(endDate, RFC3339_LOCAL_FORMAT);
}

function rateLine(entry: Entry, card: Card): string {
  if (entry.useCustomPayment) return 'Custom payment';
  if (card.rateType === 'hourly') {
    return `${card.hourlyRate ?? 0} EUR/h`;
  }
  // S21: explicit monthly branch BEFORE the fixed fallback. Without it the
  // else-clause silently mislabels monthly cards as "Fixed total: 0 EUR
  // (proportional split)" on the Google Calendar event description.
  if (card.rateType === 'monthly') {
    return `Monthly total: ${card.monthlyTotal ?? 0} EUR`;
  }
  return `Fixed total: ${card.fixedTotal ?? 0} EUR (proportional split)`;
}

export function buildEvent(entry: Entry, card: Card, allCardEntries: Entry[]): CalendarEventInput {
  // Defensive shape check. Schema validation at the form layer already
  // guarantees these invariants on new writes, BUT an entry restored from a
  // partially-broken Drive snapshot or sitting in a queued op from a pre-S16
  // build could still hit this code path with garbage. We'd rather throw a
  // clear "invalid startMinutes on entry X" here than ship `T${NaN}:${NaN}:00`
  // to Google and chase a confusing 400 "Invalid start time" back through
  // the sync log.
  if (
    !Number.isInteger(entry.startMinutes) ||
    entry.startMinutes < 0 ||
    entry.startMinutes > 1439
  ) {
    throw new Error(
      `buildEvent: invalid startMinutes (${String(entry.startMinutes)}) on entry ${entry.id}`,
    );
  }
  if (!Number.isInteger(entry.durationMin) || entry.durationMin < 1) {
    throw new Error(
      `buildEvent: invalid durationMin (${String(entry.durationMin)}) on entry ${entry.id}`,
    );
  }
  if (entry.startMinutes + entry.durationMin > 1440) {
    throw new Error(
      `buildEvent: startMinutes (${entry.startMinutes}) + durationMin (${entry.durationMin}) exceeds 1440 on entry ${entry.id}`,
    );
  }

  const earnings = earningsForEntry(entry, card, allCardEntries);
  const earningsRounded = Math.round(earnings);
  const earningsFull = earnings.toFixed(2);
  const time = formatDuration(entry.durationMin);

  const summary = `${card.name} | ${time} | ${earningsRounded} EUR`;

  // Description: each line is plain text. Note line is omitted when null /
  // empty to keep the event description compact (the user can add a note
  // later via the EntryEditor; an empty `Note:` line would be noise).
  const descLines = [
    `Card: ${card.name}`,
    `Time: ${time}`,
    `Rate: ${rateLine(entry, card)}`,
    `Earnings: ${earningsFull} EUR`,
  ];
  if (entry.note && entry.note.trim().length > 0) {
    descLines.push(`Note: ${entry.note.trim()}`);
  }
  const description = descLines.join('\n');

  // Resolve color: if the card's color isn't in the map, fall back to '8'
  // (graphite). Defensive — colors.test.ts enforces map exhaustiveness, but
  // a future palette migration could land here before the test does.
  const colorId = GOOGLE_CALENDAR_COLOR_MAP[card.color] ?? '8';

  // S16b: pull the IANA zone name from the runtime. In tests this is pinned
  // to `Europe/Kyiv` by `vitest.setup.ts` (the `process.env.TZ` pin), so
  // every `buildEvent` test sees a deterministic zone regardless of host TZ.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const startDateTime = formatWallClock(entry.date, entry.startMinutes);
  const endDateTime = formatEndWallClock(entry.date, entry.startMinutes, entry.durationMin);

  return {
    summary,
    start: { dateTime: startDateTime, timeZone },
    end: { dateTime: endDateTime, timeZone },
    description,
    colorId,
  };
}
