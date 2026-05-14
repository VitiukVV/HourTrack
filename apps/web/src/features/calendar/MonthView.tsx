import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSameMonth, isSameDay } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { eachDayInRange, formatLocalDate } from '@hourtrack/shared-utils';

import { useActiveCardStore } from '@/features/cards/useActiveCardStore';
import { cn } from '@/lib/utils';

import { useCalendarView } from './calendarStore';
import { useEntriesInRange } from './useEntriesInRange';
import { weekdayShortNames } from './calendarLocale';
import { DayCell } from './DayCell';

/**
 * The 7×{5|6} calendar month grid.
 *
 * Behaviour summary:
 *   - Weekday header row driven by date-fns locale (Mon..Sun, localized).
 *   - Days outside the current month are faded by 50% opacity.
 *   - Today's cell gets a primary-color ring + filled day-number badge.
 *   - Cells with >3 entries collapse the overflow into a `+N more` link to
 *     `/day/:date` (the DayPage built by S06).
 *   - In S04 the day-click action is INTENTIONALLY a no-op when no active
 *     card is set, and is also a no-op when an active card IS set — S05
 *     wires the active-card create/delete + no-active-card modal. We mount
 *     the click handler so the cell remains keyboard-focusable and visually
 *     responsive; S05 just swaps in the real `onDayClick`.
 */
export function MonthView() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const anchorDate = useCalendarView((s) => s.anchorDate);
  const activeCardId = useActiveCardStore((s) => s.activeCardId);

  const query = useEntriesInRange({ mode: 'month', anchorDate });

  const lang = i18n.resolvedLanguage ?? i18n.language;
  const weekdayHeaders = useMemo(() => weekdayShortNames(lang), [lang]);

  const days = useMemo(() => {
    if (!query.data) return [];
    return eachDayInRange(query.data.start, query.data.end);
  }, [query.data]);

  const anchor = new Date(anchorDate);
  const today = new Date();

  const handleDayClick = (date: string) => {
    // S04 contract: when no active card, navigating to /day/:date is the only
    // sensible action and matches PROJECT_PLAN.md §8.1 ("Day click without
    // active card → modal to pick card" lands in S05; until then we surface
    // the day page for inspection).
    if (!activeCardId) {
      navigate(`/day/${date}`);
      return;
    }
    // S05 will replace this no-op with the active-card create/delete flow.
  };

  return (
    <section data-testid="month-view" className="border-border overflow-hidden rounded-md border">
      <header
        role="row"
        className="border-border bg-muted/40 grid grid-cols-7 border-b text-xs font-medium"
      >
        {weekdayHeaders.map((name) => (
          <div
            key={name}
            role="columnheader"
            className="text-muted-foreground p-2 text-center uppercase tracking-wide"
          >
            {name}
          </div>
        ))}
      </header>

      {query.isLoading && (
        <div className="text-muted-foreground p-6 text-center text-sm">{t('common.loading')}</div>
      )}

      {query.data && (
        <div className={cn('grid grid-cols-7')}>
          {days.map((day) => {
            const date = formatLocalDate(day);
            const dayEntries = query.data!.entriesByDate.get(date) ?? [];
            return (
              <DayCell
                key={date}
                date={date}
                dayNumber={day.getDate()}
                entries={dayEntries}
                cardsById={query.data!.cardsById}
                allRangeEntries={query.data!.entries}
                isToday={isSameDay(day, today)}
                isCurrentMonth={isSameMonth(day, anchor)}
                onClick={handleDayClick}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
