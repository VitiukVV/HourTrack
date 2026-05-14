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
  getAllCards,
  getArchivedCards,
  getCardById,
  restoreCard,
  updateCard,
} from '@/lib/db';

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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
    },
  });
}

export function useArchiveCardMutation(): UseMutationResult<Card, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveCard(db, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
    },
  });
}

export function useRestoreCardMutation(): UseMutationResult<Card, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreCard(db, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
    },
  });
}
