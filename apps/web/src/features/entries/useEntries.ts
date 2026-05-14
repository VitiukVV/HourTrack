import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { Entry } from '@hourtrack/shared-types';

import { createEntry, db, deleteEntry, getEntriesByDate, updateEntry } from '@/lib/db';

/**
 * TanStack Query hooks for Entry CRUD. Mirrors the S03 cards-hook conventions:
 *   - Each hook wraps a pure DB helper and passes the singleton `db`.
 *   - Mutations invalidate the broad `['entries']` key so any range/day list
 *     in scope refreshes automatically (`useEntriesInRange` keys under
 *     `['entries', 'range', ...]`, this module's day list under
 *     `['entries', 'by-date', date]`).
 */

const ENTRIES_QUERY_KEY = ['entries'] as const;

export function useEntriesByDateQuery(date: string): UseQueryResult<Entry[]> {
  return useQuery({
    queryKey: ['entries', 'by-date', date],
    queryFn: () => getEntriesByDate(db, date),
  });
}

type EntryCreateInput = Omit<Entry, 'createdAt' | 'updatedAt'>;

export function useCreateEntryMutation(): UseMutationResult<Entry, Error, EntryCreateInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EntryCreateInput) => createEntry(db, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY });
    },
  });
}

interface UpdateEntryArgs {
  id: string;
  patch: Partial<Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>>;
}

export function useUpdateEntryMutation(): UseMutationResult<Entry, Error, UpdateEntryArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateEntryArgs) => updateEntry(db, id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY });
    },
  });
}

export function useDeleteEntryMutation(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteEntry(db, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY });
    },
  });
}
