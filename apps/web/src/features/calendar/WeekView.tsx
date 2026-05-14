import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSameDay } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { eachDayInRange, earningsForEntry, formatLocalDate } from '@hourtrack/shared-utils';

import { useActiveCardStore } from '@/features/cards/useActiveCardStore';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';

import { useCalendarView } from './calendarStore';
import { useEntriesInRange } from './useEntriesInRange';
import { weekdayShortNames } from './calendarLocale';
import { EntryChip } from './EntryChip';

/**
 * The 7-column Mon→Sun week layout. Each column shows the localized weekday
 * name + `DD.MM` short date header, followed by a vertical list of entries
 * with full information (color chip, name, duration, earnings, note marker).
 *
 * Like MonthView, the column click handler in S04 routes to `/day/:date` when
 * no active card is set; the active-card create/delete path lands in S05.
 */
export function WeekView() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const anchorDate = useCalendarView((s) => s.anchorDate);
  const activeCardId = useActiveCardStore((s) => s.activeCardId);

  const query = useEntriesInRange({ mode: 'week', anchorDate });
  const lang = i18n.resolvedLanguage ?? i18n.language;
  const weekdayHeaders = useMemo(() => weekdayShortNames(lang), [lang]);

  const days = useMemo(() => {
    if (!query.data) return [];
    return eachDayInRange(query.data.start, query.data.end);
  }, [query.data]);

  const today = new Date();

  const handleClick = (date: string) => {
    if (!activeCardId) {
      navigate(`/day/${date}`);
    }
    // S05: active-card create flow goes here.
  };

  return (
    <section data-testid="week-view" className="border-border overflow-hidden rounded-md border">
      {query.isLoading && (
        <div className="text-muted-foreground p-6 text-center text-sm">{t('common.loading')}</div>
      )}

      {query.data && (
        <div className="grid grid-cols-7">
          {days.map((day, idx) => {
            const date = formatLocalDate(day);
            const dayEntries = query.data!.entriesByDate.get(date) ?? [];
            const isToday = isSameDay(day, today);
            return (
              <div
                key={date}
                data-testid={`week-day-${date}`}
                data-today={isToday ? 'true' : 'false'}
                role="button"
                tabIndex={0}
                onClick={() => handleClick(date)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleClick(date);
                  }
                }}
                className={cn(
                  'border-border flex min-h-[20rem] flex-col gap-1 border-r p-2 text-left last:border-r-0',
                  isToday && 'bg-primary/5',
                  'hover:bg-accent/30 cursor-pointer transition-colors',
                )}
              >
                <header
                  className={cn(
                    'border-border flex items-baseline justify-between gap-1 border-b pb-1 text-xs font-medium',
                    isToday && 'text-primary',
                  )}
                >
                  <span className="uppercase tracking-wide">{weekdayHeaders[idx]}</span>
                  <span>{formatDate(date).slice(0, 5)}</span>
                </header>

                <div className="flex flex-col gap-1 overflow-y-auto">
                  {dayEntries.map((entry) => {
                    const card = query.data!.cardsById.get(entry.cardId);
                    const cardEntries = query.data!.entries.filter(
                      (x) => x.cardId === entry.cardId,
                    );
                    const earnings = card ? earningsForEntry(entry, card, cardEntries) : 0;
                    return (
                      <EntryChip
                        key={entry.id}
                        entry={entry}
                        card={card}
                        variant="row"
                        earningsEur={earnings}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
