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
 *   - Mutations invalidate the NARROW set of entry query subtrees that can
 *     actually be affected by the write, instead of the broad `['entries']`
 *     prefix:
 *       • `['entries', 'range', ...]`     — calendar grid + Reports range
 *       • `['entries', 'by-date', date]`  — DayPage list
 *       • `['entries', 'by-card', cardId]`— per-card history (e.g. fixed-rate
 *                                           proportional split in EntryEditor)
 *     Why: S07 mounts multiple long-lived range queries simultaneously and
 *     each one is potentially expensive. Invalidating the broad prefix forces
 *     them all to refetch even when only one date was touched. This narrow
 *     invalidation is the S05/S07-flagged followup.
 */

function invalidateEntryViews(
  qc: ReturnType<typeof useQueryClient>,
  date: string | undefined,
  cardId: string | undefined,
): void {
  // All range queries (calendar grids + Reports) share the `['entries', 'range']`
  // prefix. We must invalidate the prefix, not a specific (start, end) pair,
  // because the caller doesn't know what windows are active.
  void qc.invalidateQueries({ queryKey: ['entries', 'range'] });
  if (date) {
    void qc.invalidateQueries({ queryKey: ['entries', 'by-date', date] });
  }
  if (cardId) {
    void qc.invalidateQueries({ queryKey: ['entries', 'by-card', cardId] });
  }
}

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
    onSuccess: (_created, input) => {
      invalidateEntryViews(qc, input.date, input.cardId);
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
    onSuccess: (updated) => {
      // Use the returned entry to find the right date/card buckets — the
      // caller's `patch` may not include either field.
      invalidateEntryViews(qc, updated.date, updated.cardId);
    },
  });
}

export function useDeleteEntryMutation(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteEntry(db, id),
    onSuccess: () => {
      // We can't know which date/card the deleted entry belonged to once it's
      // gone, so we invalidate the range prefix (which covers ALL calendar
      // grids + reports) plus the broader `['entries', 'by-date']` and
      // `['entries', 'by-card']` prefixes. Still narrower than the original
      // `['entries']` (skips e.g. `['entries', 'meta', ...]` if we add such
      // a thing later) and crucially correct for cross-day deletes.
      void qc.invalidateQueries({ queryKey: ['entries', 'range'] });
      void qc.invalidateQueries({ queryKey: ['entries', 'by-date'] });
      void qc.invalidateQueries({ queryKey: ['entries', 'by-card'] });
    },
  });
}
