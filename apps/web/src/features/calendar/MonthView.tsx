import { useMemo, useState } from 'react';
import { isSameMonth, isSameDay, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { eachDayInRange, formatLocalDate } from '@hourtrack/shared-utils';

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
import { DayCell } from './DayCell';
import type { Card } from '@hourtrack/shared-types';

/**
 * The 7×{5|6} calendar month grid.
 *
 * Behaviour summary:
 *   - Weekday header row driven by date-fns locale (Mon..Sun, localized).
 *   - Days outside the current month are faded by 50% opacity.
 *   - Today's cell gets a primary-color ring + filled day-number badge.
 *   - Cells with >3 entries collapse the overflow into a `+N more` link to
 *     `/day/:date` (the DayPage built by S06).
 *   - S05 wires the day-click flow via `dayClickAction`:
 *       - No active card → opens the `DayPickerModal` (pick existing card OR
 *         create new card and add).
 *       - Active card + no entry on that date → creates an entry using the
 *         card's `defaultDurationMin` and `defaultNote`.
 *       - Active card + existing entry on that date → shows a confirm dialog
 *         and deletes on confirm.
 *     `+N more` link bypasses the cell click via `e.stopPropagation()` and
 *     navigates to `/day/:date` directly.
 */
export function MonthView() {
  const { t, i18n } = useTranslation();
  const anchorDate = useCalendarView((s) => s.anchorDate);
  const activeCardId = useActiveCardStore((s) => s.activeCardId);

  const query = useEntriesInRange({ mode: 'month', anchorDate });
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

  const anchor = parseISO(anchorDate);
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

  const handleDayClick = (date: string) => {
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
                entriesByCard={query.data!.entriesByCard}
                isToday={isSameDay(day, today)}
                isCurrentMonth={isSameMonth(day, anchor)}
                onClick={handleDayClick}
              />
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
              // S08 will surface this via sonner; for now log + invariant test catches.
              console.error('[MonthView] deleteEntry failed:', err);
            });
          }}
        />
      )}
    </section>
  );
}
