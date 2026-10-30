import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { ShoppingItem } from '@/shared/types';

import {
  addShoppingItem,
  db,
  deleteShoppingItem,
  getAllShoppingItems,
  setShoppingItemBought,
  updateShoppingItemText,
} from '@/lib/db';
import { useLiveRead, type LiveRead } from '@/lib/db/useLiveRead';
import i18n from '@/lib/i18n/i18n';
import { enqueueSync } from '@/features/sync/enqueueSync';

/**
 * Spec 015 — the shopping list. Reads are live over the whole (small) table;
 * the page derives each month in memory. Writes fire-and-forget a Drive push
 * like payments do (the push rebuilds the whole snapshot). Adds and ticks go
 * into `period`, the month on screen. A failed write is logged and toasted
 * here, so a `mutate` caller cannot drop it.
 */

function reportFailure(action: string): (err: Error) => void {
  return (err) => {
    console.error(`[useShoppingItems] ${action} failed:`, err);
    toast.error(i18n.t('shopping.saveFailed'));
  };
}

function enqueueShoppingPush(mutation: 'create' | 'update' | 'delete'): void {
  enqueueSync({ op: 'pushDataJson', mutation }, 'useShoppingItems');
}

export function useShoppingItems(): LiveRead<ShoppingItem[]> {
  return useLiveRead('shoppingItems', () => getAllShoppingItems(db));
}

export function useAddShoppingItemMutation(): UseMutationResult<
  ShoppingItem,
  Error,
  { cardId: string; text: string; period: string }
> {
  return useMutation({
    mutationFn: ({ cardId, text, period }) => addShoppingItem(db, cardId, text, period),
    onError: reportFailure('add'),
    onSuccess: () => enqueueShoppingPush('create'),
  });
}

export function useUpdateShoppingItemTextMutation(): UseMutationResult<
  ShoppingItem,
  Error,
  { id: string; text: string }
> {
  return useMutation({
    mutationFn: ({ id, text }) => updateShoppingItemText(db, id, text),
    onError: reportFailure('edit'),
    onSuccess: () => enqueueShoppingPush('update'),
  });
}

export function useToggleShoppingItemBoughtMutation(): UseMutationResult<
  ShoppingItem,
  Error,
  { id: string; bought: boolean; period: string }
> {
  return useMutation({
    mutationFn: ({ id, bought, period }) => setShoppingItemBought(db, id, bought, period),
    onError: reportFailure('tick'),
    onSuccess: () => enqueueShoppingPush('update'),
  });
}

export function useDeleteShoppingItemMutation(): UseMutationResult<
  ShoppingItem | null,
  Error,
  string
> {
  return useMutation({
    mutationFn: (id: string) => deleteShoppingItem(db, id),
    onError: reportFailure('delete'),
    onSuccess: () => enqueueShoppingPush('delete'),
  });
}
