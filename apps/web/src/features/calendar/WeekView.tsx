import { useMemo, useState } from 'react';
import { isSameDay } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { eachDayInRange, earningsForEntry, formatLocalDate } from '@hourtrack/shared-utils';

import { useActiveCardStore } from '@/features/cards/useActiveCardStore';
import { ConfirmDialog } from '@/features/entries/ConfirmDialog';
import { DayPickerModal } from '@/features/entries/DayPickerModal';
import { dayClickAction, type DayClickAction } from '@/features/entries/dayClick';
import { useCreateEntryMutation, useDeleteEntryMutation } from '@/features/entries/useEntries';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';

import { useCalendarView } from './calendarStore';
import { useEntriesInRange } from './useEntriesInRange';
import { weekdayShortNames } from './calendarLocale';
import { EntryChip } from './EntryChip';
import type { Card } from '@hourtrack/shared-types';

/**
 * The 7-column Mon→Sun week layout. Each column shows the localized weekday
 * name + `DD.MM` short date header, followed by a vertical list of entries
 * with full information (color chip, name, duration, earnings, note marker).
 *
 * Click behaviour mirrors MonthView (S05):
 *   - no active card → DayPickerModal
 *   - active card + no entry on date → create with card defaults
 *   - active card + existing entry on date → confirm + delete
 *
 * `role="button"` is intentionally OMITTED on the column wrapper to avoid
 * nested-interactive HTML (the column contains chips that are themselves
 * interactive in S06). The column remains keyboard-reachable via tabIndex.
 */
export function WeekView() {
  const { t, i18n } = useTranslation();
  const anchorDate = useCalendarView((s) => s.anchorDate);
  const activeCardId = useActiveCardStore((s) => s.activeCardId);

  const query = useEntriesInRange({ mode: 'week', anchorDate });
  const createEntry = useCreateEntryMutation();
  const deleteEntry = useDeleteEntryMutation();

  const [pickerDate, setPickerDate] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<(DayClickAction & { kind: 'delete' }) | null>(
    null,
  );

  const lang = i18n.resolvedLanguage ?? i18n.language;
  const weekdayHeaders = useMemo(() => weekdayShortNames(lang), [lang]);

  const days = useMemo(() => {
    if (!query.data) return [];
    return eachDayInRange(query.data.start, query.data.end);
  }, [query.data]);

  const today = new Date();

  const createEntryForCardOnDate = (card: Card, date: string) => {
    void createEntry.mutateAsync({
      id: crypto.randomUUID(),
      cardId: card.id,
      date,
      durationMin: card.defaultDurationMin,
      useCustomPayment: false,
      customPayment: null,
      note: card.defaultNote ?? null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
    });
  };

  const handleClick = (date: string) => {
    if (!query.data) return;
    const action = dayClickAction({
      activeCardId,
      cardsById: query.data.cardsById,
      entriesByCard: query.data.entriesByCard,
      date,
    });
    switch (action.kind) {
      case 'open-picker':
        setPickerDate(date);
        return;
      case 'create':
        createEntryForCardOnDate(action.card, date);
        return;
      case 'delete':
        setPendingDelete(action);
        return;
    }
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
                tabIndex={0}
                aria-label={date}
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
                    const cardEntries = query.data!.entriesByCard.get(entry.cardId) ?? [];
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

      {pickerDate != null && (
        <DayPickerModal
          open
          date={pickerDate}
          onOpenChange={(o) => {
            if (!o) setPickerDate(null);
          }}
          onPick={(card) => {
            createEntryForCardOnDate(card, pickerDate);
            setPickerDate(null);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setPendingDelete(null);
          }}
          title={t('entries.confirmDelete.title')}
          body={t('entries.confirmDelete.body', {
            card: pendingDelete.card.name,
            date: formatDate(pendingDelete.date),
          })}
          confirmLabel={t('entries.confirmDelete.confirm')}
          cancelLabel={t('entries.confirmDelete.cancel')}
          onConfirm={() => {
            const entryId = pendingDelete.entry.id;
            setPendingDelete(null);
            void deleteEntry.mutateAsync(entryId).catch((err) => {
              console.error('[WeekView] deleteEntry failed:', err);
            });
          }}
        />
      )}
    </section>
  );
}
