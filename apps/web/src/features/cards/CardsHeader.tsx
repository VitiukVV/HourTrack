import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Card } from '@hourtrack/shared-types';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { CardChip } from './CardChip';
import { CardModal } from './CardModal';
import { useActiveCardStore } from './useActiveCardStore';
import { useArchiveCardMutation, useCardsQuery } from './useCards';

interface ContextMenuState {
  card: Card;
  x: number;
  y: number;
}

/**
 * Sticky header for the calendar page. Shows the `+ Add card` button followed
 * by a horizontally scrolling carousel of non-archived card chips. Clicking
 * a chip toggles it active in the `useActiveCardStore` (sessionStorage-backed,
 * shared by S05 day-click flow). Right-click on a chip raises a small floating
 * menu with Edit / Archive.
 *
 * Archive is a soft delete via `useArchiveCardMutation`. We surface a
 * `window.confirm` so the user can't archive by accident; the production
 * notification/confirmation surface (sonner / shadcn Alert) lands in S08.
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

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside / Escape closes the context menu.
  useEffect(() => {
    if (!contextMenu) return;
    function onDown(e: MouseEvent | globalThis.MouseEvent) {
      const target = e.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setContextMenu(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setContextMenu(null);
    }
    document.addEventListener('mousedown', onDown as unknown as EventListener);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown as unknown as EventListener);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const cards = cardsQuery.data ?? [];

  const handleContextMenu = (card: Card) => (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setContextMenu({ card, x: e.clientX, y: e.clientY });
  };

  const handleEdit = () => {
    if (!contextMenu) return;
    setModalState({ open: true, mode: 'edit', card: contextMenu.card });
    setContextMenu(null);
  };

  const handleArchive = async () => {
    if (!contextMenu) return;
    const card = contextMenu.card;
    setContextMenu(null);
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
      <div className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto px-4 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setModalState({ open: true, mode: 'create' })}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('cards.addCard')}
        </Button>

        <div className="flex items-center gap-2 overflow-x-auto">
          {cards.length === 0 && cardsQuery.isSuccess && (
            <span className="text-muted-foreground text-xs">{t('cards.noCards')}</span>
          )}
          {cards.map((card) => (
            <CardChip
              key={card.id}
              card={card}
              isActive={activeCardId === card.id}
              onClick={() => toggleActive(card.id)}
              onContextMenu={handleContextMenu(card)}
            />
          ))}
        </div>
      </div>

      {/* Context menu — minimal floating popover, intentionally not a Radix
          dropdown so that right-click positioning works at click coordinates. */}
      {contextMenu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={contextMenu.card.name}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className={cn(
            'border-border bg-popover text-popover-foreground fixed z-50 min-w-[10rem] rounded-md border p-1 shadow-md',
          )}
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleEdit}
            className="hover:bg-accent hover:text-accent-foreground block w-full rounded-sm px-3 py-1.5 text-left text-sm"
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void handleArchive();
            }}
            className="hover:bg-accent hover:text-accent-foreground block w-full rounded-sm px-3 py-1.5 text-left text-sm"
          >
            {t('cards.archive')}
          </button>
        </div>
      )}

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
