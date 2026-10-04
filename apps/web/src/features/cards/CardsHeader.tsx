import { MoreHorizontal, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { DndContext, closestCenter, type Modifier } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { CardModal } from './CardModal';
import { SortableCardChip } from './SortableCardChip';
import { useCardsHeaderController } from './useCardsHeaderController';

/**
 * The row is one line of pills, so a drag has nothing to say about the y
 * axis. Pinning it keeps the held chip inside its `overflow-x-auto` scroll
 * container — dragged out of it, the chip is clipped while still resolving a
 * drop target, which looks like the gesture broke.
 */
const restrictToRowAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

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
 * (open + mode + card-being-edited, via `useCardsHeaderController`) so
 * AppLayout doesn't need to coordinate.
 */
export function CardsHeader() {
  const { t } = useTranslation();
  const {
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
  } = useCardsHeaderController();

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
