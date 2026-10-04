import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Announcements, DragEndEvent } from '@dnd-kit/core';

import type { Card } from '@hourtrack/shared-types';

import { useMediaQuery } from '@/lib/hooks/useMediaQuery';

import { resolveCardReorder } from './cardReorder';
import { useCardRowSensors } from './useCardRowSensors';
import { useActiveCardStore } from './useActiveCardStore';
import { useArchiveCardMutation, useCardsQuery, useReorderCardsMutation } from './useCards';

/**
 * Spec 008 — the state and behaviour behind `CardsHeader`: the card row, the
 * active card, the create/edit modal and archive-confirm state, and the
 * drag-to-reorder wiring (sensors, screen-reader announcements, drop →
 * reorder). The component keeps only the markup.
 */
export function useCardsHeaderController() {
  const { t } = useTranslation();
  const cardsQuery = useCardsQuery();
  const archive = useArchiveCardMutation();
  const reorder = useReorderCardsMutation();
  const activeCardId = useActiveCardStore((s) => s.activeCardId);
  const toggleActive = useActiveCardStore((s) => s.toggleActive);
  // Touch devices fire `contextmenu` on long-press, which Radix's
  // ContextMenu.Trigger surfaces as an edit/archive menu — the user found
  // this surprising while drag-scrolling the chip carousel. On coarse
  // pointers we render plain chips (no ContextMenu wrapper); the 3-dot
  // dropdown next to the carousel remains the dedicated edit/archive
  // affordance. Desktop right-click keeps the legacy ContextMenu surface.
  const isCoarsePointer = useMediaQuery('(pointer: coarse)');

  const [modalState, setModalState] = useState<
    { open: false } | { open: true; mode: 'create' } | { open: true; mode: 'edit'; card: Card }
  >({ open: false });
  // Card pending archive confirmation. Mirrors the `ArchiveSection`
  // hard-delete flow (pending-card state + shared `ConfirmDialog`) instead of
  // the blocking, unthemed `window.confirm`.
  const [pendingArchive, setPendingArchive] = useState<Card | null>(null);

  // Memoised for its identity, not its cost: it is a dependency of the
  // drag announcements below, and the `?? []` on an unresolved query would
  // otherwise hand them a fresh array on every render.
  const cards = useMemo(() => cardsQuery.data ?? [], [cardsQuery.data]);
  const activeCard =
    activeCardId != null ? (cards.find((c) => c.id === activeCardId) ?? null) : null;

  const handleEdit = (card: Card) => () => {
    // Defer past Radix's menu close + animation so the menu's scroll-lock
    // fully decrements BEFORE the Dialog opens its own. Without this defer
    // the two locks stack during the menu's close transition and
    // `document.body.style.pointerEvents` stays `none` even after the
    // menu closes, leaving the rest of the app unclickable — and even
    // after the Dialog closes, the orphaned counter keeps the body
    // scroll-locked. A `setTimeout(0)` lets Radix's microtask cleanup
    // fully run; longer delays improve reliability when the menu has a
    // visible close transition. `handleArchive` defers the same way.
    setTimeout(() => {
      setModalState({ open: true, mode: 'edit', card });
    }, 0);
  };

  const handleArchive = (card: Card) => () => {
    // Defer past Radix's menu close + animation before opening the Dialog —
    // same scroll-lock stacking pitfall handled in `handleEdit` (a `setTimeout(0)`
    // lets Radix's microtask cleanup decrement the menu's lock before the
    // Dialog adds its own). Replaces the old `window.confirm` flow, which was
    // blocking, unthemed, and forced its own focus-race workaround.
    setTimeout(() => {
      setPendingArchive(card);
    }, 0);
  };

  // The input recipe (sensors + key bindings) lives in its own hook, where
  // each load-bearing choice is documented and pinned by a test.
  const sensors = useCardRowSensors();

  const announcements = useMemo<Announcements>(() => {
    const nameOf = (id: string | number): string =>
      cards.find((c) => c.id === String(id))?.name ?? String(id);
    const position = (id: string | number): number =>
      cards.findIndex((c) => c.id === String(id)) + 1;
    return {
      onDragStart: ({ active }) => t('cards.reorder.picked', { card: nameOf(active.id) }),
      onDragOver: ({ active, over }) =>
        over
          ? t('cards.reorder.over', { card: nameOf(active.id), position: position(over.id) })
          : undefined,
      onDragEnd: ({ active, over }) => {
        // Announce what will be WRITTEN, not merely what was dropped on. A
        // drop whose ids no longer match the row writes nothing, and telling
        // a screen-reader user "moved to position 3" when nothing moved is
        // worse than saying it did not happen.
        const outcome = resolveCardReorder(cards, String(active.id), over?.id);
        if (outcome.kind === 'moved') {
          return t('cards.reorder.dropped', {
            card: nameOf(active.id),
            position: outcome.toIndex + 1,
          });
        }
        if (outcome.kind === 'stale') return t('cards.reorder.staleRow');
        return t('cards.reorder.cancelled', { card: nameOf(active.id) });
      },
      onDragCancel: ({ active }) => t('cards.reorder.cancelled', { card: nameOf(active.id) }),
    };
  }, [cards, t]);

  const handleDragEnd = (event: DragEndEvent) => {
    const cardId = String(event.active.id);
    const outcome = resolveCardReorder(cards, cardId, event.over?.id);
    if (outcome.kind === 'stale') {
      // The row changed under the drag (a background sync applied while the
      // finger was down). The user asked for a move and is not getting one,
      // so say so — dnd-kit's own announcement has already told a screen
      // reader the drop happened.
      console.error('[CardsHeader] drag ended against a stale row:', {
        cardId,
        overId: event.over?.id,
      });
      toast.error(t('cards.reorder.staleRow'));
      return;
    }
    if (outcome.kind === 'noop') return;
    reorder.mutate({ cardId, toIndex: outcome.toIndex });
  };

  const handleConfirmArchive = () => {
    const target = pendingArchive;
    if (!target) return;
    setPendingArchive(null);
    archive.mutateAsync(target.id).catch((err: unknown) => {
      console.error('[CardsHeader] archive failed:', err);
      toast.error(t('cards.archiveFailed'));
    });
  };

  return {
    cardsQuery,
    activeCardId,
    toggleActive,
    isCoarsePointer,
    modalState,
    setModalState,
    pendingArchive,
    setPendingArchive,
    cards,
    activeCard,
    handleEdit,
    handleArchive,
    sensors,
    announcements,
    handleDragEnd,
    handleConfirmArchive,
  };
}
