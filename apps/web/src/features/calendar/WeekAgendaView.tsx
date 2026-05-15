import { useMemo } from 'react';
import { isSameDay, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import {
  eachDayInRange,
  earningsForEntry,
  formatDuration,
  formatLocalDate,
} from '@hourtrack/shared-utils';
import type { Card, Entry } from '@hourtrack/shared-types';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';

import { weekdayShortNames } from './calendarLocale';
import { EntryChip } from './EntryChip';

interface WeekAgendaViewProps {
  /** First day in the visible range (YYYY-MM-DD). */
  start: string;
  /** Last day in the visible range (YYYY-MM-DD, inclusive). */
  end: string;
  /** Entries grouped by `YYYY-MM-DD` key. */
  entriesByDate: Map<string, Entry[]>;
  cardsById: Map<string, Card>;
  /** Per-card entry buckets across the range — needed by `earningsForEntry`. */
  entriesByCard: Map<string, Entry[]>;
  /**
   * Chip-tap handler. Same contract as `MonthView` / `WeekView` — fires
   * `(entryId)` and the consuming `WeekView` parent opens the S17 edit modal.
   */
  onEntryEdit?: (entryId: string) => void;
}

/**
 * S18 — Mobile-friendly **agenda** layout for the WeekView. Replaces the
 * `< md` grid-of-7-columns (unreadable at 375px) with a vertical scrollable
 * list grouped by day, mirroring Google Calendar's "Schedule" mode.
 *
 * Each day section:
 *   - Header: weekday name + dd.MM short date + per-day duration total.
 *   - Body: zero-or-more EntryChip rows (variant="row") — chip taps route
 *     through `onEntryEdit` to open the S17 edit modal.
 *   - Empty day: a single muted "No entries" line so the day is still
 *     visible (the user shouldn't have to wonder "is this rendered or
 *     filtered out").
 *
 * Empty week: the entire 7-day range with zero entries collapses to a
 * shared `EmptyState` with a CTA jumping to today's DayPage. Empty days
 * (some entries this week but none on this date) still render the muted
 * inline line — only the entirely-empty week triggers the EmptyState
 * escape hatch.
 */
export function WeekAgendaView({
  start,
  end,
  entriesByDate,
  cardsById,
  entriesByCard,
  onEntryEdit,
}: WeekAgendaViewProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const lang = i18n.resolvedLanguage ?? i18n.language;
  const weekdayHeaders = useMemo(() => weekdayShortNames(lang), [lang]);

  const days = useMemo(() => eachDayInRange(parseISO(start), parseISO(end)), [start, end]);

  const today = useMemo(() => new Date(), []);

  // Aggregate week total (durationMin) across all entries in the range.
  const weekTotalMin = useMemo(() => {
    let total = 0;
    for (const day of days) {
      const date = formatLocalDate(day);
      const dayEntries = entriesByDate.get(date) ?? [];
      for (const entry of dayEntries) {
        total += entry.durationMin;
      }
    }
    return total;
  }, [days, entriesByDate]);

  const hasAnyEntries = weekTotalMin > 0;

  if (!hasAnyEntries) {
    // Entirely empty week → escape to shared EmptyState with a CTA back
    // to today's DayPage.
    const todayDate = formatLocalDate(today);
    return (
      <EmptyState
        testId="week-agenda-empty"
        title={t('calendar.agenda.noEntriesWeek')}
        body={t('calendar.agenda.noEntriesWeek')}
        cta={
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="week-agenda-empty-cta"
            onClick={() => navigate(`/day/${todayDate}`)}
          >
            {t('calendar.agenda.addForToday')}
          </Button>
        }
      />
    );
  }

  return (
    <section data-testid="week-agenda" className="flex flex-col gap-3">
      {/* Week-total banner — sum of all entry durations across the visible 7 days. */}
      <div
        data-testid="week-agenda-total"
        className="border-border bg-muted/40 flex items-center justify-between rounded-md border px-3 py-2 text-sm"
      >
        <span className="text-muted-foreground">{t('calendar.agenda.weekTotal')}</span>
        <span className="font-medium tabular-nums">{formatDuration(weekTotalMin)}</span>
      </div>

      <ol className="flex flex-col gap-2">
        {days.map((day, idx) => {
          const date = formatLocalDate(day);
          const dayEntries = entriesByDate.get(date) ?? [];
          const isToday = isSameDay(day, today);
          const dayTotalMin = dayEntries.reduce((sum, e) => sum + e.durationMin, 0);

          return (
            <li
              key={date}
              data-testid={`week-agenda-day-${date}`}
              data-today={isToday ? 'true' : 'false'}
              className={cn(
                'border-border bg-background flex flex-col gap-1 rounded-md border p-2',
                isToday && 'border-primary/50 bg-primary/5',
              )}
            >
              <header
                className={cn(
                  'flex items-baseline justify-between gap-2 text-xs',
                  isToday && 'text-primary',
                )}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-medium uppercase tracking-wide">{weekdayHeaders[idx]}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatDate(date).slice(0, 5)}
                  </span>
                </div>
                {dayEntries.length > 0 && (
                  <span
                    data-testid={`week-agenda-day-${date}-total`}
                    className="text-muted-foreground tabular-nums"
                  >
                    {formatDuration(dayTotalMin)}
                  </span>
                )}
              </header>

              {dayEntries.length === 0 ? (
                <p
                  data-testid={`week-agenda-day-${date}-empty`}
                  className="text-muted-foreground/70 px-1 py-1 text-xs italic"
                >
                  {t('calendar.agenda.noEntriesDay')}
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {dayEntries.map((entry) => {
                    const card = cardsById.get(entry.cardId);
                    const cardEntries = entriesByCard.get(entry.cardId) ?? [];
                    const earnings = card ? earningsForEntry(entry, card, cardEntries) : 0;
                    return (
                      <EntryChip
                        key={entry.id}
                        entry={entry}
                        card={card}
                        variant="row"
                        earningsEur={earnings}
                        onEdit={onEntryEdit}
                      />
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
