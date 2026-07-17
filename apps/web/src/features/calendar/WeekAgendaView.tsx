import { useMemo, type ReactNode } from 'react';
import { isSameDay, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useDroppable } from '@dnd-kit/core';

import {
  eachDayInRange,
  earningsForEntry,
  formatDuration,
  formatLocalDate,
} from '@hourtrack/shared-utils';
import type { Card, Entry } from '@hourtrack/shared-types';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
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
  /**
   * S25 — when true, chips become drag sources and every day card (INCLUDING
   * empty days — dropping onto an empty day is a primary mobile flow) becomes
   * a droppable target keyed by its `date`. The parent `WeekView` owns the
   * `DndContext`; the agenda only registers droppables + draggables into it.
   */
  dragEnabled?: boolean;
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
  dragEnabled = false,
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
        body={t('calendar.agenda.noEntriesWeekBody')}
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
    // Muted surface tone for the agenda container so the day cards (`bg-card`,
    // pure surface white in light mode) read as elevated above the page — the
    // standard Material/Apple "list of cards" treatment. Without this, the
    // cards float on the same color as their content and the day separation
    // disappears the moment any entry chip is full card-color.
    <section
      data-testid="week-agenda"
      className="bg-muted/30 -mx-2 flex flex-col gap-3 rounded-lg p-2"
    >
      {/* Week-total banner — sum of all entry durations across the visible 7 days. */}
      <div
        data-testid="week-agenda-total"
        className="border-border bg-background flex items-center justify-between rounded-md border px-3 py-2 text-sm shadow-sm"
      >
        <span className="text-muted-foreground">{t('calendar.agenda.weekTotal')}</span>
        <span className="font-medium tabular-nums">{formatDuration(weekTotalMin)}</span>
      </div>

      <ol className="flex flex-col gap-2.5">
        {days.map((day, idx) => {
          const date = formatLocalDate(day);
          const dayEntries = entriesByDate.get(date) ?? [];
          const isToday = isSameDay(day, today);
          // Saturday (6) + Sunday (0) get a subtle tint shift so the eye
          // catches the week-rhythm without having to count rows.
          const dayOfWeek = day.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const isEmpty = dayEntries.length === 0;
          const dayTotalMin = dayEntries.reduce((sum, e) => sum + e.durationMin, 0);

          return (
            <AgendaDayCard
              key={date}
              date={date}
              isToday={isToday}
              isWeekend={isWeekend}
              isEmpty={isEmpty}
              dragEnabled={dragEnabled}
            >
              {/* Left accent stripe — primary-saturated for today, muted
                  neutral for the rest. A vertical band that anchors the
                  date column and gives every card a clear left edge. */}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-y-0 left-0 w-1',
                  isToday
                    ? 'bg-primary'
                    : isWeekend
                      ? 'bg-muted-foreground/30'
                      : 'bg-foreground/15',
                )}
              />

              {/* Date column — bold day number on top, short weekday under.
                  This is the agenda anchor: glance left → "where am I in
                  the week", glance right → "what was on this day". */}
              <div
                className={cn(
                  'flex w-12 shrink-0 flex-col items-center justify-center pl-1',
                  isToday && 'text-primary',
                )}
              >
                <span className="text-2xl leading-none font-bold tabular-nums">
                  {day.getDate()}
                </span>
                <span
                  className={cn(
                    'mt-1 text-[10px] font-semibold tracking-wider uppercase',
                    !isToday && 'text-muted-foreground',
                  )}
                >
                  {weekdayHeaders[idx]}
                </span>
              </div>

              {/* Thin vertical divider between the date column and the
                  entry list — separates "when" from "what" inside the card. */}
              <div className="bg-border w-px self-stretch" aria-hidden="true" />

              {/* Body column — per-day total (right-aligned, small) +
                  entry chips OR the muted "no entries" line. */}
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {!isEmpty && (
                  <div className="flex justify-end">
                    <span
                      data-testid={`week-agenda-day-${date}-total`}
                      className="text-muted-foreground text-xs tabular-nums"
                    >
                      {formatDuration(dayTotalMin)}
                    </span>
                  </div>
                )}

                {isEmpty ? (
                  <p
                    data-testid={`week-agenda-day-${date}-empty`}
                    className="text-muted-foreground/70 self-start text-xs italic"
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
                          dragEnabled={dragEnabled}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </AgendaDayCard>
          );
        })}
      </ol>
    </section>
  );
}

interface AgendaDayCardProps {
  date: string;
  isToday: boolean;
  isWeekend: boolean;
  isEmpty: boolean;
  dragEnabled: boolean;
  children: ReactNode;
}

/**
 * S25 — a single agenda day card, made a droppable target keyed by its
 * `date`. Extracted from the WeekAgendaView map because `useDroppable` is a
 * hook. Droppable for EVERY day including empty ones (dropping onto an
 * otherwise-empty day is a primary mobile flow — spec Task 12). The
 * `isOver` highlight (primary ring) reads over the card surface on
 * light/dark.
 */
function AgendaDayCard({
  date,
  isToday,
  isWeekend,
  isEmpty,
  dragEnabled,
  children,
}: AgendaDayCardProps) {
  const { setNodeRef, isOver } = useDroppable({ id: date, disabled: !dragEnabled });
  return (
    <li
      ref={setNodeRef}
      data-testid={`week-agenda-day-${date}`}
      data-today={isToday ? 'true' : 'false'}
      data-drop-over={isOver ? 'true' : 'false'}
      className={cn(
        // Base card: surface tone + clear contour + tactile shadow.
        'border-border bg-card relative flex gap-3 overflow-hidden rounded-lg border p-3 shadow-sm transition-shadow',
        // Weekend rhythm: very subtle bg shift.
        isWeekend && !isToday && 'bg-muted/40',
        // Empty days read as visibly "lighter" via dashed border + reduced
        // opacity — a clear "nothing here" affordance.
        isEmpty && !isToday && 'border-dashed opacity-75',
        // Today: primary-tinted surface + 4px left accent stripe.
        isToday && 'bg-primary/5 border-primary/40 shadow-md',
        // S25 — drop-target highlight while a chip hovers this day card.
        isOver && 'ring-primary bg-primary/15 ring-2 ring-inset',
      )}
    >
      {children}
    </li>
  );
}
