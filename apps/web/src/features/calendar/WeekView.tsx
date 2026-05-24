import { useCallback, useMemo, useState } from 'react';
import { isSameDay } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { eachDayInRange, earningsForEntry, formatLocalDate } from '@hourtrack/shared-utils';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DayPickerModal } from '@/features/entries/DayPickerModal';
import { EntryEditModal } from '@/features/entries/EntryEditModal';
import { useDayClickFlow } from '@/features/entries/useDayClickFlow';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { useMediaQuery, MEDIA_QUERIES } from '@/lib/hooks/useMediaQuery';

import { useCalendarView } from './calendarStore';
import { useEntriesInRange } from './useEntriesInRange';
import { weekdayShortNames } from './calendarLocale';
import { EntryChip } from './EntryChip';
import { WeekAgendaView } from './WeekAgendaView';

/**
 * The 7-column Mon→Sun week layout. Each column shows the localized weekday
 * name + `DD.MM` short date header, followed by a vertical list of entries
 * with full information (color chip, name, duration, earnings, note marker).
 *
 * Click behaviour mirrors MonthView (S05/S06):
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

  const query = useEntriesInRange({ mode: 'week', anchorDate });

  const lang = i18n.resolvedLanguage ?? i18n.language;
  const weekdayHeaders = useMemo(() => weekdayShortNames(lang), [lang]);

  const days = useMemo(() => {
    if (!query.data) return [];
    return eachDayInRange(query.data.start, query.data.end);
  }, [query.data]);

  // S05 followup: stable `today` reference for the lifetime of the mount.
  const today = useMemo(() => new Date(), []);

  const flow = useDayClickFlow({
    cardsById: query.data?.cardsById ?? new Map(),
    entriesByCard: query.data?.entriesByCard ?? new Map(),
  });

  // S17 — per-view local state for the inline entry-edit modal (see
  // MonthView.tsx for the rationale). WeekView and MonthView each own their
  // own `editingEntryId` because they're never mounted simultaneously.
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  // S23 — stable handler for `memo(EntryChip)` + `WeekAgendaView` so chip
  // re-renders don't cascade on every WeekView render. `setEditingEntryId`
  // is itself stable, so the empty deps array is safe.
  const handleEntryEdit = useCallback((id: string) => setEditingEntryId(id), []);

  // S18 — at `< md` (≤ 767px, most phones in portrait) render the agenda
  // (vertical scrollable list grouped by day). At `md:+` the legacy
  // 7-column grid renders. The breakpoint mirrors the calendar UX gap:
  // 7 columns at 375px = 53px each — illegible even with the 2-letter
  // weekday header.
  const isBelowMd = useMediaQuery(MEDIA_QUERIES.belowMd);

  return (
    <section data-testid="week-view" className="border-border overflow-hidden rounded-md border">
      {query.isLoading && (
        <div className="text-muted-foreground p-6 text-center text-sm">{t('common.loading')}</div>
      )}

      {query.data && isBelowMd && (
        <div data-testid="week-view-agenda-wrap" className="p-2">
          <WeekAgendaView
            start={query.data.start}
            end={query.data.end}
            entriesByDate={query.data.entriesByDate}
            cardsById={query.data.cardsById}
            entriesByCard={query.data.entriesByCard}
            onEntryEdit={handleEntryEdit}
          />
        </div>
      )}

      {query.data && !isBelowMd && (
        // Match the MonthView grid treatment: a darker tinted background
        // painted by the parent shows through the column gaps as a clearly
        // visible divider line, so individual day columns read as discrete
        // cards even with full card-color entry chips inside.
        <div data-testid="week-view-grid" className="bg-foreground/20 grid grid-cols-7 gap-1">
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
                onClick={() => flow.handleDayClick(date)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    flow.handleDayClick(date);
                  }
                }}
                className={cn(
                  'bg-background flex min-h-[20rem] flex-col gap-1 p-2 text-left',
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
                        onEdit={handleEntryEdit}
                      />
                    );
                  })}
                </div>
              </div>
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

      {/* S17: inline entry-edit modal, mounted once at WeekView root. */}
      <EntryEditModal
        entryId={editingEntryId}
        open={!!editingEntryId}
        onOpenChange={(o) => {
          if (!o) setEditingEntryId(null);
        }}
      />
    </section>
  );
}
