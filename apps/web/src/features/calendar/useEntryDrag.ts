import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Card, Entry } from '@hourtrack/shared-types';

import { formatDate } from '@/lib/date';
import { useUpdateEntryMutation } from '@/features/entries/useEntries';

import { resolveEntryMove } from './dragMove';

/**
 * S25 — drag payload attached to each draggable chip via
 * `useDraggable({ data })`. `onDragEnd` reads it off `active.data.current`.
 * `card` is optional (a corrupt restore may leave a dangling cardId) — only
 * used for the screen-reader announcement / overlay label.
 */
export interface EntryDragData {
  entry: Entry;
  card: Card | undefined;
}

/**
 * The active drag's payload, surfaced for the `<DragOverlay>` clone.
 */
export interface ActiveDrag {
  entry: Entry;
  card: Card | undefined;
}

export interface UseEntryDragResult {
  sensors: ReturnType<typeof useSensors>;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  activeEntry: Entry | null;
  activeCard: Card | undefined;
  announcements: Announcements;
  screenReaderInstructions: ScreenReaderInstructions;
}

/**
 * S25 — owns the drag lifecycle for entry-reschedule across MonthView,
 * WeekView grid, and the mobile WeekAgendaView. Returns everything a view
 * needs to wire `<DndContext>` + `<DragOverlay>`.
 *
 * Sensor strategy (S0b — LOAD-BEARING, see PERF_NOTES.md):
 *   - TouchSensor delay 220 / tolerance 8: a swipe still scrolls the agenda;
 *     only a deliberate press-and-hold starts a drag (UR-25-2).
 *   - PointerSensor distance 8: snappy desktop mouse drag, no scroll ambiguity.
 *   - KeyboardSensor: a11y pick-up / move / drop.
 *
 * Move semantics:
 *   - NOT optimistic. The chip stays on the source day until
 *     `useUpdateEntryMutation`'s onSuccess surgical patch lands (Dexie write is
 *     fast), then it jumps to the target. On failure nothing moved → just a
 *     toast, no rollback (spec Task 4b / Notes "No optimistic move").
 *   - Same-day / no-`over` drops short-circuit in `resolveEntryMove` BEFORE any
 *     mutation (spec "Same-day no-op is mandatory").
 */
export function useEntryDrag(): UseEntryDragResult {
  const { t } = useTranslation();
  const updateEntry = useUpdateEntryMutation();

  const [active, setActive] = useState<ActiveDrag | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as EntryDragData | undefined;
    if (data?.entry) setActive({ entry: data.entry, card: data.card });
  }, []);

  const onDragCancel = useCallback(() => setActive(null), []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const data = event.active.data.current as EntryDragData | undefined;
      const entry = data?.entry;
      // Clear the overlay regardless of outcome.
      setActive(null);
      if (!entry) return;

      const overId = event.over?.id;
      if (overId == null) return; // dropped outside any droppable → no-op
      const toDate = String(overId);

      const move = resolveEntryMove(entry, toDate);
      if (!move) return; // same-day / malformed → no mutation, no toast

      const fromDate = entry.date;
      updateEntry
        .mutateAsync(move)
        .then(() => {
          // Success toast with a working Undo that re-mutates date back to
          // the original. Skip on same-day (already short-circuited above).
          toast.success(t('calendar.move.done', { date: formatDate(toDate) }), {
            action: {
              label: t('calendar.move.undo'),
              onClick: () => {
                updateEntry
                  .mutateAsync({ id: entry.id, patch: { date: fromDate } })
                  .then(() => {
                    toast.success(t('calendar.move.undone', { date: formatDate(fromDate) }));
                  })
                  .catch((err: unknown) => {
                    console.error('[useEntryDrag] undo move failed:', err);
                    toast.error(t('calendar.move.failed'));
                  });
              },
            },
          });
        })
        .catch((err: unknown) => {
          // No optimistic move → nothing to roll back; the chip never left
          // the source day. Just surface the failure.
          console.error('[useEntryDrag] move failed:', err);
          toast.error(t('calendar.move.failed'));
        });
    },
    [updateEntry, t],
  );

  // Localized SR announcements + instructions for the DndContext a11y layer.
  const announcements = useMemo<Announcements>(() => {
    const nameOf = (id: string | number): string => {
      // The active drag holds the entry's card name for the announcement.
      return active?.card?.name ?? String(id);
    };
    return {
      onDragStart({ active: a }) {
        return t('calendar.dnd.picked', { card: nameOf(a.id) });
      },
      onDragOver({ active: a, over }) {
        if (!over) return undefined;
        return t('calendar.dnd.over', {
          card: nameOf(a.id),
          date: formatDate(String(over.id)),
        });
      },
      onDragEnd({ active: a, over }) {
        if (!over) return t('calendar.dnd.cancelled', { card: nameOf(a.id) });
        return t('calendar.dnd.dropped', {
          card: nameOf(a.id),
          date: formatDate(String(over.id)),
        });
      },
      onDragCancel({ active: a }) {
        return t('calendar.dnd.cancelled', { card: nameOf(a.id) });
      },
    };
  }, [active, t]);

  const screenReaderInstructions = useMemo<ScreenReaderInstructions>(
    () => ({ draggable: t('calendar.dnd.instructions') }),
    [t],
  );

  return {
    sensors,
    onDragStart,
    onDragEnd,
    onDragCancel,
    activeEntry: active?.entry ?? null,
    activeCard: active?.card,
    announcements,
    screenReaderInstructions,
  };
}
