import { useMutation, type UseMutationResult } from '@tanstack/react-query';

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
import { enqueueSync } from '@/features/sync/enqueueSync';

/**
 * Spec 015 — the shopping list. Reads are live over the whole (small) table;
 * the page derives each month in memory. Writes fire-and-forget a Drive push
 * like payments do (the push rebuilds the whole snapshot). Failures surface to
 * the caller, which toasts.
 */

function enqueueShoppingPush(mutation: 'create' | 'update' | 'delete'): void {
  enqueueSync({ op: 'pushDataJson', mutation }, 'useShoppingItems');
}

export function useShoppingItems(): LiveRead<ShoppingItem[]> {
  return useLiveRead('shoppingItems', () => getAllShoppingItems(db));
}

export function useAddShoppingItemMutation(): UseMutationResult<
  ShoppingItem,
  Error,
  { cardId: string; text: string }
> {
  return useMutation({
    mutationFn: ({ cardId, text }) => addShoppingItem(db, cardId, text),
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
    onSuccess: () => enqueueShoppingPush('update'),
  });
}

export function useToggleShoppingItemBoughtMutation(): UseMutationResult<
  ShoppingItem,
  Error,
  { id: string; bought: boolean }
> {
  return useMutation({
    mutationFn: ({ id, bought }) => setShoppingItemBought(db, id, bought),
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
    onSuccess: () => enqueueShoppingPush('delete'),
  });
}
