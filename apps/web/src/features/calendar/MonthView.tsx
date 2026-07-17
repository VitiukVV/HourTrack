import { useCallback, useMemo, useState } from 'react';
import { isSameMonth, isSameDay, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { DndContext, DragOverlay } from '@dnd-kit/core';

import { eachDayInRange, formatLocalDate } from '@hourtrack/shared-utils';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DayPickerModal } from '@/features/entries/DayPickerModal';
import { EntryEditModal } from '@/features/entries/EntryEditModal';
import { useDayClickFlow } from '@/features/entries/useDayClickFlow';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';

import { useCalendarView } from './calendarStore';
import { useEntriesInRange } from './useEntriesInRange';
import { useEntryDrag } from './useEntryDrag';
import { weekdayMicroNames, weekdayShortNames } from './calendarLocale';
import { DayCell } from './DayCell';
import { EntryChip } from './EntryChip';

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
  const weekdayHeadersMicro = useMemo(() => weekdayMicroNames(lang), [lang]);

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

  // S17 — per-view local state for the inline entry-edit modal. No Zustand
  // slice: MonthView and WeekView are never mounted simultaneously, and no
  // other surface reads this id. A click on any chip sets the id; the
  // modal's `onOpenChange(false)` clears it.
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  // S23 — `memo(DayCell)` and `memo(EntryChip)` rely on prop reference
  // equality. Without `useCallback`, the inline `(id) => setEditingEntryId(id)`
  // below would allocate a fresh function on every MonthView render and
  // bypass every cell's memo. `setEditingEntryId` is itself stable
  // (React guarantees state-setter identity), so a deps-empty callback is
  // safe.
  const handleEntryEdit = useCallback((id: string) => setEditingEntryId(id), []);

  // S25 — drag-to-reschedule. One DndContext wraps the grid; every chip is a
  // drag source (`dragEnabled`) and every DayCell is a droppable. The
  // DragOverlay renders a clone of the dragged chip so it follows the
  // finger/pointer while the source dims in place.
  const drag = useEntryDrag();

  // S13: dropped `role="row"` + `role="columnheader"` from the weekday
  // header strip. Without an enclosing `role="grid"` / `role="table"`,
  // these orphan roles trigger axe-core's `aria-required-parent` rule. The
  // strip is decorative — it just labels the seven columns — so removing
  // the roles in favor of natural `<header><div>` semantics is the correct
  // a11y posture rather than fabricating a partial grid scaffolding.
  return (
    <section
      data-testid="month-view"
      className="border-border overflow-hidden rounded-md border shadow-sm"
    >
      <header className="border-border bg-muted/50 grid grid-cols-7 border-b text-xs font-semibold">
        {weekdayHeaders.map((name, idx) => {
          // Mon=0 .. Sun=6 in this header strip (date-fns locale-driven). The
          // 7th and 6th entries map to Saturday & Sunday for the en/uk locales
          // used in the app; we apply a soft accent so the weekend columns
          // are visually distinguished in the header too — matches the
          // per-cell weekend tint below.
          const isWeekendCol = idx === 5 || idx === 6;
          return (
            <div
              key={name}
              className={cn(
                'p-1.5 text-center tracking-wider uppercase sm:p-2',
                isWeekendCol ? 'text-foreground/70' : 'text-muted-foreground',
              )}
            >
              {/* S18 — 2-letter abbreviations on `< sm`, 3-letter on `sm:+`. */}
              <span className="sm:hidden">{weekdayHeadersMicro[idx]}</span>
              <span className="hidden sm:inline">{name}</span>
            </div>
          );
        })}
      </header>

      {query.isLoading && (
        <div className="text-muted-foreground p-6 text-center text-sm">{t('common.loading')}</div>
      )}

      {query.data && (
        <DndContext
          sensors={drag.sensors}
          onDragStart={drag.onDragStart}
          onDragEnd={drag.onDragEnd}
          onDragCancel={drag.onDragCancel}
          accessibility={{
            announcements: drag.announcements,
            screenReaderInstructions: drag.screenReaderInstructions,
          }}
        >
          {/* Grid gap painted by the parent's bg produces uniform separator
              lines between cells without each cell drawing matching borders.
              `bg-foreground/20` gives a clearly visible divider in both
              light and dark mode; `gap-1` (4px) reads on mobile DPR without
              eating real cell area. */}
          <div className={cn('bg-foreground/20 grid grid-cols-7 gap-1')}>
            {days.map((day) => {
              const date = formatLocalDate(day);
              const dayEntries = query.data!.entriesByDate.get(date) ?? [];
              const dayOfWeek = day.getDay();
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
                  isWeekend={dayOfWeek === 0 || dayOfWeek === 6}
                  onClick={flow.handleDayClick}
                  onEntryEdit={handleEntryEdit}
                  dragEnabled
                />
              );
            })}
          </div>

          {/* Drag clone follows the pointer/finger. The source chip stays put
              (dimmed) until the move's onSuccess patch lands. */}
          <DragOverlay>
            {drag.activeEntry ? (
              <EntryChip entry={drag.activeEntry} card={drag.activeCard} />
            ) : null}
          </DragOverlay>
        </DndContext>
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

      {/* S17: inline entry-edit modal, mounted once at MonthView root.
          Driven by `editingEntryId` local state; chip clicks set it,
          the modal's `onOpenChange(false)` clears it. */}
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
