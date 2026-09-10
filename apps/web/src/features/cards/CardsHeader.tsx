import { useMemo, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  DndContext,
  closestCenter,
  type Announcements,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';

import type { Card } from '@hourtrack/shared-types';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';

import { resolveCardReorder } from './cardReorder';
import { CardModal } from './CardModal';
import { SortableCardChip } from './SortableCardChip';
import { useCardRowSensors } from './useCardRowSensors';
import { useActiveCardStore } from './useActiveCardStore';
import { useArchiveCardMutation, useCardsQuery, useReorderCardsMutation } from './useCards';

/**
 * Sticky header for the calendar page. Shows a horizontally scrolling
 * carousel of non-archived card chips, with an icon-only `+` button on
 * the right (S19 UR-19-6 Task 15) and — when a card is active — an
 * adjacent 3-dot dropdown menu offering Edit / Archive for that card
 * (S19 UR-19-7 Task 16).
 *
 * Clicking a chip toggles it active in the `useActiveCardStore`
 * (sessionStorage-backed, shared by S05 day-click flow). Right-click on a
 * chip raises a Radix ContextMenu with Edit / Archive — that legacy surface
 * is preserved (per spec Task 16) because it complements the new 3-dot
 * affordance for power users.
 *
 * S13: migrated from a bespoke positioned-div menu (S03) to Radix
 * `@radix-ui/react-context-menu`. Radix handles viewport-edge collision,
 * keyboard navigation, focus trap, and Escape-to-dismiss.
 *
 * S19: carousel uses `scrollbar-none` to hide the scrollbar on mobile
 * (UR-19-9 Task 22). Horizontal swipe still works.
 *
 * The component is intentionally self-contained — it owns the CardModal state
 * (open + mode + card-being-edited) so AppLayout doesn't need to coordinate.
 */
/**
 * The row is one line of pills, so a drag has nothing to say about the y
 * axis. Pinning it keeps the held chip inside its `overflow-x-auto` scroll
 * container — dragged out of it, the chip is clipped while still resolving a
 * drop target, which looks like the gesture broke.
 */
const restrictToRowAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

export function CardsHeader() {
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
    // visible close transition. Same intent as `handleArchive`'s
    // `await Promise.resolve()` deferred-confirm flow.
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

  return (
    <div data-testid="cards-header" className="border-border bg-background border-b">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
        {/* Chip carousel — scrolls horizontally, scrollbar hidden on mobile.
            The row is also the dnd-kit auto-scroll container, so a drag that
            reaches its edge scrolls the row rather than stalling. */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToRowAxis]}
          onDragEnd={handleDragEnd}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: t('cards.reorder.instructions') },
          }}
        >
          <SortableContext items={cards.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
            <div className="flex flex-1 scrollbar-none items-center gap-2 overflow-x-auto">
              {cards.length === 0 && cardsQuery.isSuccess && (
                <span className="text-muted-foreground text-xs">{t('cards.noCards')}</span>
              )}
              {cards.map((card, idx) => {
                // Cancel the native contextmenu (which mobile browsers fire on
                // long-press) when the user is on a coarse pointer. Without this
                // suppression iOS Safari / Chrome on Android display the system
                // "copy / search" menu over the chip on long-press.
                const chip = (
                  <SortableCardChip
                    card={card}
                    isActive={activeCardId === card.id}
                    onClick={() => toggleActive(card.id)}
                    onContextMenu={(e) => {
                      if (isCoarsePointer) {
                        e.preventDefault();
                      }
                      /* Desktop right-click is handled by Radix via the Trigger. */
                    }}
                    {...(idx === 0 ? { 'data-testid': 'cards-header-first-chip' } : {})}
                  />
                );
                if (isCoarsePointer) {
                  // Mobile: no ContextMenu wrapper at all — the 3-dot dropdown
                  // next to the carousel is the dedicated edit/archive affordance.
                  return <span key={card.id}>{chip}</span>;
                }
                return (
                  <ContextMenu.Root key={card.id}>
                    <ContextMenu.Trigger asChild>{chip}</ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content
                        className="border-border bg-popover text-popover-foreground z-50 min-w-[10rem] rounded-md border p-1 shadow-md"
                        collisionPadding={8}
                        data-testid={`cards-header-menu-${card.id}`}
                      >
                        <ContextMenu.Item
                          onSelect={handleEdit(card)}
                          className="hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground block w-full cursor-pointer rounded-sm px-3 py-1.5 text-left text-sm outline-none"
                        >
                          {t('common.edit')}
                        </ContextMenu.Item>
                        <ContextMenu.Item
                          onSelect={handleArchive(card)}
                          className="hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground block w-full cursor-pointer rounded-sm px-3 py-1.5 text-left text-sm outline-none"
                        >
                          {t('cards.archive')}
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        {/* Right-side action cluster: 3-dot (only when active) + plus. */}
        <div className="flex shrink-0 items-center gap-1">
          {activeCard && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t('common.edit')}
                  data-testid="cards-header-active-menu-trigger"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" data-testid="cards-header-active-menu-content">
                <DropdownMenuItem
                  onSelect={handleEdit(activeCard)}
                  data-testid="cards-header-active-menu-edit"
                >
                  {t('common.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={handleArchive(activeCard)}
                  data-testid="cards-header-active-menu-archive"
                >
                  {t('cards.archive')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t('cards.addCard')}
            data-testid="cards-header-add-button"
            onClick={() => setModalState({ open: true, mode: 'create' })}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {modalState.open && modalState.mode === 'create' && (
        <CardModal
          mode="create"
          open
          onOpenChange={(o) => {
            if (!o) setModalState({ open: false });
          }}
        />
      )}
      {modalState.open && modalState.mode === 'edit' && (
        <CardModal
          mode="edit"
          card={modalState.card}
          open
          onOpenChange={(o) => {
            if (!o) setModalState({ open: false });
          }}
        />
      )}

      <ConfirmDialog
        open={pendingArchive !== null}
        onOpenChange={(open) => {
          if (!open) setPendingArchive(null);
        }}
        title={t('cards.archiveTitle')}
        body={pendingArchive ? t('cards.confirmArchive', { name: pendingArchive.name }) : ''}
        confirmLabel={t('cards.archive')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleConfirmArchive}
      />
    </div>
  );
}
