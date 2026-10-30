import { Pencil, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { ShoppingItem } from '@/shared/types';
import { SHOPPING_TEXT_MAX, normalizeShoppingText } from '@/shared/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { noAutofill } from '@/lib/utils/noAutofill';
import { cn } from '@/lib/utils/utils';

import {
  useDeleteShoppingItemMutation,
  useToggleShoppingItemBoughtMutation,
  useUpdateShoppingItemTextMutation,
} from './useShoppingItems';

interface ShoppingItemRowProps {
  item: ShoppingItem;
  /** Bought in the month being viewed — ticked and struck through. */
  bought: boolean;
}

/**
 * One item on a house's list (spec 015): a checkbox to tick it bought, its
 * text (wrapping — a long note must not widen the page), and edit / delete.
 * Editing is inline: Enter or leaving the field saves, Esc cancels.
 */
export function ShoppingItemRow({ item, bought }: ShoppingItemRowProps) {
  const { t } = useTranslation();
  const checkboxId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const toggle = useToggleShoppingItemBoughtMutation();
  const update = useUpdateShoppingItemTextMutation();
  const remove = useDeleteShoppingItemMutation();

  const onError = () => toast.error(t('shopping.saveFailed'));

  const commitEdit = () => {
    if (draft === null) return;
    const text = normalizeShoppingText(draft);
    setDraft(null);
    if (text === null || text === item.text) return;
    update.mutate({ id: item.id, text }, { onError });
  };

  return (
    <li className="flex items-center gap-2 py-1" data-testid="shopping-item">
      <input
        id={checkboxId}
        type="checkbox"
        className="accent-primary size-5 shrink-0"
        checked={bought}
        onChange={(e) => toggle.mutate({ id: item.id, bought: e.target.checked }, { onError })}
      />
      {draft === null ? (
        <label
          htmlFor={checkboxId}
          className={cn(
            'min-w-0 flex-1 text-sm break-words',
            bought && 'text-muted-foreground line-through',
          )}
        >
          {item.text}
        </label>
      ) : (
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            commitEdit();
          }}
        >
          <Input
            {...noAutofill('shopping-item-edit')}
            type="text"
            autoFocus
            value={draft}
            maxLength={SHOPPING_TEXT_MAX}
            aria-label={t('shopping.edit', { text: item.text })}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(null);
              }
            }}
          />
        </form>
      )}
      {draft === null && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label={t('shopping.edit', { text: item.text })}
          onClick={() => setDraft(item.text)}
        >
          <Pencil className="size-4" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive shrink-0"
        aria-label={t('shopping.delete', { text: item.text })}
        onClick={() => remove.mutate(item.id, { onError })}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}
