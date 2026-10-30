import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Card } from '@/shared/types';
import { SHOPPING_TEXT_MAX, normalizeShoppingText, type ShoppingMonth } from '@/shared/utils';

import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/Disclosure';
import { Input } from '@/components/ui/input';
import { noAutofill } from '@/lib/utils/noAutofill';

import { ShoppingItemRow } from './ShoppingItemRow';
import { useAddShoppingItemMutation } from './useShoppingItems';

interface ShoppingHouseBlockProps {
  card: Card;
  /** This house's list for the month being viewed. */
  month: ShoppingMonth;
}

/**
 * One house on the Purchases page (spec 015): its colour, name and how many
 * things are still needed, then the list — needed first, bought (struck
 * through) after — and a field to add the next item. Opens by itself when the
 * month has items; an empty house stays collapsed to its name. The page keys
 * the block by month, so stepping months re-applies that rule.
 */
export function ShoppingHouseBlock({ card, month }: ShoppingHouseBlockProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const add = useAddShoppingItemMutation();
  const hasItems = month.needed.length + month.bought.length > 0;

  const submit = () => {
    const text = normalizeShoppingText(draft);
    if (text === null) return;
    add.mutate(
      { cardId: card.id, text },
      {
        onSuccess: () => setDraft(''),
        onError: () => toast.error(t('shopping.saveFailed')),
      },
    );
  };

  return (
    <Disclosure
      defaultOpen={hasItems}
      header={
        <span className="flex min-w-0 items-center gap-2" data-testid="shopping-house-header">
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: card.color }}
          />
          <span className="min-w-0 flex-1 truncate font-medium">{card.name}</span>
          {month.needed.length > 0 && (
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {t('shopping.needed', { count: month.needed.length })}
            </span>
          )}
        </span>
      }
    >
      {hasItems ? (
        <ul className="flex flex-col">
          {month.needed.map((item) => (
            <ShoppingItemRow key={item.id} item={item} bought={false} />
          ))}
          {month.bought.map((item) => (
            <ShoppingItemRow key={item.id} item={item} bought />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t('shopping.empty')}</p>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          {...noAutofill('shopping-item-add')}
          type="text"
          value={draft}
          maxLength={SHOPPING_TEXT_MAX}
          placeholder={t('shopping.addPlaceholder')}
          aria-label={t('shopping.addLabel', { house: card.name })}
          onChange={(e) => setDraft(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={add.isPending || draft.trim().length === 0}>
          {t('shopping.add')}
        </Button>
      </form>
    </Disclosure>
  );
}
