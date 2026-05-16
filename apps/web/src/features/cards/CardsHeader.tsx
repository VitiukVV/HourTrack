import { useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as ContextMenu from '@radix-ui/react-context-menu';

import type { Card } from '@hourtrack/shared-types';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { CardChip } from './CardChip';
import { CardModal } from './CardModal';
import { useActiveCardStore } from './useActiveCardStore';
import { useArchiveCardMutation, useCardsQuery } from './useCards';

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
export function CardsHeader() {
  const { t } = useTranslation();
  const cardsQuery = useCardsQuery();
  const archive = useArchiveCardMutation();
  const activeCardId = useActiveCardStore((s) => s.activeCardId);
  const toggleActive = useActiveCardStore((s) => s.toggleActive);

  const [modalState, setModalState] = useState<
    { open: false } | { open: true; mode: 'create' } | { open: true; mode: 'edit'; card: Card }
  >({ open: false });

  const cards = cardsQuery.data ?? [];
  const activeCard =
    activeCardId != null ? (cards.find((c) => c.id === activeCardId) ?? null) : null;

  const handleEdit = (card: Card) => () => {
    setModalState({ open: true, mode: 'edit', card });
  };

  const handleArchive = (card: Card) => async () => {
    // Defer to the next tick so Radix can finish closing the menu and
    // returning focus before window.confirm steals it (avoids a focus
    // race that left the menu trigger visually focused-but-unreachable).
    await Promise.resolve();
    if (
      typeof window !== 'undefined' &&
      !window.confirm(t('cards.confirmArchive', { name: card.name }))
    ) {
      return;
    }
    try {
      await archive.mutateAsync(card.id);
    } catch (err) {
      console.error('[CardsHeader] archive failed:', err);
    }
  };

  return (
    <div
      data-testid="cards-header"
      className="border-border bg-background sticky top-[3.25rem] z-10 border-b"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
        {/* Chip carousel — scrolls horizontally, scrollbar hidden on mobile. */}
        <div className="scrollbar-none flex flex-1 items-center gap-2 overflow-x-auto">
          {cards.length === 0 && cardsQuery.isSuccess && (
            <span className="text-muted-foreground text-xs">{t('cards.noCards')}</span>
          )}
          {cards.map((card, idx) => (
            <ContextMenu.Root key={card.id}>
              <ContextMenu.Trigger asChild>
                <CardChip
                  card={card}
                  isActive={activeCardId === card.id}
                  onClick={() => toggleActive(card.id)}
                  // Radix's Trigger merges its own onContextMenu handler with
                  // any we pass via Slot. We provide a no-op so the prop
                  // shape stays stable; Radix wins the dispatch order via
                  // Slot's merger and opens the floating menu.
                  onContextMenu={() => {
                    /* Radix handles this via the Trigger wrapper. */
                  }}
                  {...(idx === 0 ? { 'data-testid': 'cards-header-first-chip' } : {})}
                />
              </ContextMenu.Trigger>
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
                    onSelect={() => {
                      void handleArchive(card)();
                    }}
                    className="hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground block w-full cursor-pointer rounded-sm px-3 py-1.5 text-left text-sm outline-none"
                  >
                    {t('cards.archive')}
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          ))}
        </div>

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
                  onSelect={() => {
                    void handleArchive(activeCard)();
                  }}
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
    </div>
  );
}
