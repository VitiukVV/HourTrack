import { useTranslation } from 'react-i18next';

import type { Card } from '@hourtrack/shared-types';

import { Button } from '@/components/ui/button';

import { useArchivedCardsQuery, useRestoreCardMutation } from './useCards';

interface ArchivedCardsListProps {
  /** Optional hard-delete handler. S03 does not ship a hard-delete mutation; */
  /** S08/S10 will wire one (`deleteCardPermanently`) that also tombstones for sync. */
  onDeletePermanently?: (card: Card) => void;
}

/**
 * Renders the archived-cards section consumed by the Settings page (S08).
 * Each row shows the card name + color dot plus Restore and (optionally)
 * Delete permanently buttons. Restore is wired here via
 * `useRestoreCardMutation`; the hard-delete handler is left to the parent so
 * S08 can layer in the double-confirm + Drive tombstone propagation.
 *
 * Empty state surfaces a localized hint.
 */
export function ArchivedCardsList({ onDeletePermanently }: ArchivedCardsListProps) {
  const { t } = useTranslation();
  const query = useArchivedCardsQuery();
  const restore = useRestoreCardMutation();

  const cards = query.data ?? [];

  if (query.isSuccess && cards.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="archived-cards-empty">
        {t('cards.noArchivedCards')}
      </p>
    );
  }

  return (
    <ul className="divide-border divide-y" data-testid="archived-cards-list">
      {cards.map((card) => (
        <li key={card.id} className="flex items-center justify-between gap-2 py-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: card.color }}
            />
            <span className="text-sm">{card.name}</span>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void restore.mutateAsync(card.id);
              }}
              disabled={restore.isPending}
            >
              {t('cards.restore')}
            </Button>
            {onDeletePermanently && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => onDeletePermanently(card)}
              >
                {t('cards.deletePermanently')}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
