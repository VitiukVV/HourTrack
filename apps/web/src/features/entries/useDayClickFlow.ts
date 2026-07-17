import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Card, Entry } from '@hourtrack/shared-types';

import { useActiveCardStore } from '@/features/cards/useActiveCardStore';

import { dayClickAction, type DayClickAction } from './dayClick';
import { useCreateEntryMutation, useDeleteEntryMutation } from './useEntries';

/**
 * Encapsulates the calendar day-click flow shared by MonthView and WeekView.
 *
 * Before S06 the flow lived inline in both views (~50 LOC each), which made
 * the two implementations drift over time. This hook extracts:
 *
 *   - Local UI state (`pickerDate`, `pendingDelete`).
 *   - The pure `dayClickAction` dispatch step.
 *   - The two mutations (create / delete) and their side-effect handlers.
 *   - Modal close-on-cancel handlers that the views wire to dialog
 *     `onOpenChange` props.
 *
 * The hook is intentionally framework-state-only — it does NOT subscribe to
 * `useEntriesInRange`. Callers pass `cardsById` + `entriesByCard` directly
 * because the calendar surface uses ONE range query that lives in the parent
 * view; we don't want the hook to fire a second redundant query.
 *
 * Carries forward the active-card source-of-truth: the hook reads
 * `useActiveCardStore` directly so callers don't have to thread the id
 * through props.
 */

export interface UseDayClickFlowArgs {
  cardsById: Map<string, Card>;
  entriesByCard: Map<string, Entry[]>;
}

export interface UseDayClickFlowResult {
  /** YYYY-MM-DD of the day that triggered the no-active-card picker, else null. */
  pickerDate: string | null;
  /** Pending-delete action (carries entry + card + date), else null. */
  pendingDelete: (DayClickAction & { kind: 'delete' }) | null;
  /** Dispatcher for a day cell click. */
  handleDayClick: (date: string) => void;
  /** Creates an entry for `card` on `date` using the card's defaults. */
  createEntryForCardOnDate: (card: Card, date: string) => void;
  /** Confirms the pending delete (runs the mutation, clears state). */
  confirmDelete: () => void;
  /** Clears the picker state without picking. */
  closePicker: () => void;
  /** Clears the pending delete without confirming. */
  closeDelete: () => void;
}

export function useDayClickFlow(args: UseDayClickFlowArgs): UseDayClickFlowResult {
  const { cardsById, entriesByCard } = args;
  const activeCardId = useActiveCardStore((s) => s.activeCardId);
  const { t } = useTranslation();

  const createEntry = useCreateEntryMutation();
  const deleteEntry = useDeleteEntryMutation();

  const [pickerDate, setPickerDate] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<(DayClickAction & { kind: 'delete' }) | null>(
    null,
  );

  // S29 Task 12 — the calendar surface memoizes `DayCell`. These callbacks are
  // passed to every cell, so they MUST be reference-stable or the `memo`
  // bailout is defeated and a drag pick-up re-renders all ~42 cells. `useCallback`
  // keeps the identities stable across renders (mutation objects from TanStack
  // Query are already stable; `t` is stable from react-i18next).
  const createEntryForCardOnDate = useCallback(
    (card: Card, date: string) => {
      // S29 Task 13 — `.mutate` with an `onError` toast instead of a fire-and-
      // forget `void mutateAsync(...)` that swallowed Dexie failures, leaving
      // the tap a silent no-op. Mirrors `useEntryDrag`'s error handling.
      createEntry.mutate(
        {
          id: crypto.randomUUID(),
          cardId: card.id,
          date,
          // S16: copy the card's default start-of-day onto the new entry so
          // the v2 schema is satisfied. The visible time picker that lets the
          // user override per-entry lands in S16b.
          startMinutes: card.defaultStartMinutes,
          durationMin: card.defaultDurationMin,
          useCustomPayment: false,
          customPayment: null,
          note: card.defaultNote ?? null,
          googleEventId: null,
          syncStatus: 'pending',
          syncError: null,
        },
        {
          onError: (err) => {
            console.error('[useDayClickFlow] createEntry failed:', err);
            toast.error(t('entries.saveFailed'));
          },
        },
      );
    },
    [createEntry, t],
  );

  const handleDayClick = useCallback(
    (date: string) => {
      const action = dayClickAction({
        activeCardId,
        cardsById,
        entriesByCard,
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
    },
    [activeCardId, cardsById, entriesByCard, createEntryForCardOnDate],
  );

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const entryId = pendingDelete.entry.id;
    setPendingDelete(null);
    deleteEntry.mutate(entryId, {
      onError: (err) => {
        console.error('[useDayClickFlow] deleteEntry failed:', err);
        toast.error(t('entries.deleteFailed'));
      },
    });
  }, [pendingDelete, deleteEntry, t]);

  const closePicker = useCallback(() => setPickerDate(null), []);
  const closeDelete = useCallback(() => setPendingDelete(null), []);

  return {
    pickerDate,
    pendingDelete,
    handleDayClick,
    createEntryForCardOnDate,
    confirmDelete,
    closePicker,
    closeDelete,
  };
}
