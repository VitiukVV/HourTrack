import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { Card } from '@hourtrack/shared-types';

import {
  archiveCard,
  createCard,
  db,
  deleteCardPermanently,
  getAllCards,
  getArchivedCards,
  getCardById,
  restoreCard,
  updateCard,
} from '@/lib/db';
import { getSyncManager } from '@/features/sync/SyncManager';

/**
 * Notify the SyncManager that a card change should be pushed to Drive.
 * Fire-and-forget — the manager handles debounce, retry, and offline.
 * Wrapped so a sync-internal error never breaks the mutation chain.
 */
function enqueueCardPush(mutation: 'create' | 'update' | 'delete', cardId: string): void {
  void getSyncManager()
    .enqueue({
      op: 'pushDataJson',
      mutation,
      entityType: 'card',
      entityId: cardId,
    })
    .catch((err: unknown) => {
      console.warn('[useCards] enqueue sync failed', err);
    });
}

/**
 * TanStack Query hooks for Cards. Each hook wraps a pure DB function and
 * passes the singleton `db` from `@/lib/db`. NEVER import or call the singleton
 * directly inside the pure functions — they take it as their first argument so
 * tests can construct isolated `HourTrackDB(<name>)` instances.
 *
 * Query keys:
 *   ['cards', 'active']    — non-archived cards (default header carousel)
 *   ['cards', 'archived']  — archived cards (settings archive list)
 *   ['cards', 'by-id', id] — single card detail (rare; mostly an internal cache)
 *
 * Every mutation invalidates `['cards']` (matches both lists) so any view
 * reflects writes instantly.
 */

export const CARDS_QUERY_KEY = ['cards'] as const;
const ACTIVE_KEY = ['cards', 'active'] as const;
const ARCHIVED_KEY = ['cards', 'archived'] as const;

export function useCardsQuery(): UseQueryResult<Card[]> {
  return useQuery({
    queryKey: ACTIVE_KEY,
    queryFn: () => getAllCards(db, false),
  });
}

export function useArchivedCardsQuery(): UseQueryResult<Card[]> {
  return useQuery({
    queryKey: ARCHIVED_KEY,
    queryFn: () => getArchivedCards(db),
  });
}

/**
 * Returns ALL cards (active + archived when `includeArchived = true`). Used by:
 *   - DayPage (S06): orphan-card safety — entries may reference cards that have
 *     since been archived, so the row needs the card record to render the chip.
 *   - Reports (S07): "Show archived" toggle expands the multi-select pool to
 *     include archived cards.
 *
 * Cache key: `['cards', 'all', includeArchived]` — distinct from `useCardsQuery`
 * (`['cards', 'active']`) so callers that want everything don't accidentally
 * read a filtered cache. The `includeArchived` flag is part of the key so
 * flipping it doesn't return stale data.
 *
 * S03 mutations all invalidate the broad `['cards']` key, so this hook
 * refreshes automatically when cards are created / updated / archived /
 * restored.
 */
export function useAllCardsQuery(includeArchived: boolean): UseQueryResult<Card[]> {
  return useQuery({
    queryKey: ['cards', 'all', includeArchived] as const,
    queryFn: () => getAllCards(db, includeArchived),
  });
}

export function useCardQuery(id: string | null | undefined): UseQueryResult<Card | undefined> {
  return useQuery({
    queryKey: ['cards', 'by-id', id ?? null],
    queryFn: () => (id ? getCardById(db, id) : Promise.resolve(undefined)),
    enabled: !!id,
  });
}

type CardCreateInput = Omit<Card, 'createdAt' | 'updatedAt'>;

export function useCreateCardMutation(): UseMutationResult<Card, Error, CardCreateInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CardCreateInput) => createCard(db, input),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
      enqueueCardPush('create', created.id);
    },
  });
}

interface UpdateCardArgs {
  id: string;
  patch: Partial<Omit<Card, 'id' | 'createdAt' | 'updatedAt'>>;
}

export function useUpdateCardMutation(): UseMutationResult<Card, Error, UpdateCardArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateCardArgs) => updateCard(db, id, patch),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
      enqueueCardPush('update', updated.id);
    },
  });
}

export function useArchiveCardMutation(): UseMutationResult<Card, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveCard(db, id),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
      // Archive is treated as an update from the sync POV: the row stays
      // in `cards[]` with `isArchived: true`. No tombstone is needed.
      enqueueCardPush('update', updated.id);
    },
  });
}

export function useRestoreCardMutation(): UseMutationResult<Card, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreCard(db, id),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
      enqueueCardPush('update', updated.id);
    },
  });
}

/**
 * Hard-delete a card and cascade to its entries. Used by the S08 Settings
 * "Delete permanently" affordance. Invalidates the broad `['cards']` prefix
 * AND the entry prefixes (`['entries', 'range']`, `['entries', 'by-date']`,
 * `['entries', 'by-card']`) so the calendar/day-page/reports surfaces all
 * pick up the cascade.
 *
 * The active-card store is also cleared here when the user hard-deletes the
 * currently active card; otherwise the chip carousel would render a stale
 * pointer.
 */
export function useDeleteCardMutation(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCardPermanently(db, id),
    onSuccess: (_void, deletedId) => {
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
      // Cascade also affects entries — invalidate every entry view shape so
      // the calendar grid, day page, and reports refresh.
      void qc.invalidateQueries({ queryKey: ['entries', 'range'] });
      void qc.invalidateQueries({ queryKey: ['entries', 'by-date'] });
      void qc.invalidateQueries({ queryKey: ['entries', 'by-card'] });
      // The query layer already wrote tombstones for the card AND each
      // cascaded entry — the sync push will pick them up automatically.
      enqueueCardPush('delete', deletedId);
    },
  });
}
