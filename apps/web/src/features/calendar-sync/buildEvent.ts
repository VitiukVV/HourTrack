import { addDays, format, parseISO } from 'date-fns';

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
 * All-day events use `start.date` + `end.date` where `end` is exclusive
 * (`date + 1 day`) per Calendar API convention.
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

/**
 * Date math is done as plain string addition because all-day events are
 * timezone-free. Parse the `YYYY-MM-DD` into a Date, add 1 day, format back.
 * `date-fns` does this without timezone surprises when the input is treated
 * as local midnight (which `parseISO` does for date-only strings).
 */
function nextDay(dateLocal: string): string {
  return format(addDays(parseISO(dateLocal), 1), 'yyyy-MM-dd');
}

function rateLine(entry: Entry, card: Card): string {
  if (entry.useCustomPayment) return 'Custom payment';
  if (card.rateType === 'hourly') {
    return `${card.hourlyRate ?? 0} EUR/h`;
  }
  return `Fixed total: ${card.fixedTotal ?? 0} EUR (proportional split)`;
}

export function buildEvent(entry: Entry, card: Card, allCardEntries: Entry[]): CalendarEventInput {
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

  return {
    summary,
    start: { date: entry.date },
    end: { date: nextDay(entry.date) },
    description,
    colorId,
  };
}
