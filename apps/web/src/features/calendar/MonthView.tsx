import { useMemo } from 'react';
import { isSameMonth, isSameDay, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { eachDayInRange, formatLocalDate } from '@hourtrack/shared-utils';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DayPickerModal } from '@/features/entries/DayPickerModal';
import { useDayClickFlow } from '@/features/entries/useDayClickFlow';
import { formatDate } from '@/lib/date';
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
 *   - Day-click flow is delegated to `useDayClickFlow` (S06 carried followup
 *     from S05). That hook owns picker state, pending-delete state, and the
 *     create/delete mutations; this view only renders the dialogs and forwards
 *     the click.
 */
export function MonthView() {
  const { t, i18n } = useTranslation();
  const anchorDate = useCalendarView((s) => s.anchorDate);

  const query = useEntriesInRange({ mode: 'month', anchorDate });

  const lang = i18n.resolvedLanguage ?? i18n.language;
  const weekdayHeaders = useMemo(() => weekdayShortNames(lang), [lang]);

  const days = useMemo(() => {
    if (!query.data) return [];
    return eachDayInRange(query.data.start, query.data.end);
  }, [query.data]);

  const anchor = parseISO(anchorDate);
  // S05 followup: stable `today` reference for the whole mount instead of
  // re-creating per render. Day boundary doesn't matter inside a single
  // render pass — if the user keeps the tab open across midnight, the
  // anchor-change re-mount will refresh it.
  const today = useMemo(() => new Date(), []);

  const flow = useDayClickFlow({
    cardsById: query.data?.cardsById ?? new Map(),
    entriesByCard: query.data?.entriesByCard ?? new Map(),
  });

  // S13: dropped `role="row"` + `role="columnheader"` from the weekday
  // header strip. Without an enclosing `role="grid"` / `role="table"`,
  // these orphan roles trigger axe-core's `aria-required-parent` rule. The
  // strip is decorative — it just labels the seven columns — so removing
  // the roles in favor of natural `<header><div>` semantics is the correct
  // a11y posture rather than fabricating a partial grid scaffolding.
  return (
    <section data-testid="month-view" className="border-border overflow-hidden rounded-md border">
      <header className="border-border bg-muted/40 grid grid-cols-7 border-b text-xs font-medium">
        {weekdayHeaders.map((name) => (
          <div key={name} className="text-muted-foreground p-2 text-center uppercase tracking-wide">
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
                onClick={flow.handleDayClick}
              />
            );
          })}
        </div>
      )}

      {flow.pickerDate != null && (
        <DayPickerModal
          open
          date={flow.pickerDate}
          onOpenChange={(o) => {
            if (!o) flow.closePicker();
          }}
          onPick={(card) => {
            flow.createEntryForCardOnDate(card, flow.pickerDate!);
            flow.closePicker();
          }}
        />
      )}

      {flow.pendingDelete && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) flow.closeDelete();
          }}
          title={t('entries.confirmDelete.title')}
          body={t('entries.confirmDelete.body', {
            card: flow.pendingDelete.card.name,
            date: formatDate(flow.pendingDelete.date),
          })}
          confirmLabel={t('entries.confirmDelete.confirm')}
          cancelLabel={t('entries.confirmDelete.cancel')}
          onConfirm={flow.confirmDelete}
        />
      )}
    </section>
  );
}
