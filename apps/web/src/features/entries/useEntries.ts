import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { Entry } from '@hourtrack/shared-types';

import { createEntry, db, deleteEntry, getEntriesByDate, updateEntry } from '@/lib/db';
import { getSyncManager } from '@/features/sync/SyncManager';

/**
 * Notify the SyncManager that an entry change should be pushed to Drive.
 * Fire-and-forget — the manager handles debounce + retry + offline + lock.
 */
function enqueueEntryPush(mutation: 'create' | 'update' | 'delete', entryId: string): void {
  void getSyncManager()
    .enqueue({
      op: 'pushDataJson',
      mutation,
      entityType: 'entry',
      entityId: entryId,
    })
    .catch((err: unknown) => {
      console.warn('[useEntries] enqueue sync failed', err);
    });
}

/**
 * Enqueue the Calendar create-event op for a new entry. S12 wires the real
 * Calendar API insert — handler stamps `googleEventId` on success.
 */
function enqueueCreateCalendarEvent(entryId: string): void {
  void getSyncManager()
    .enqueue({
      op: 'createCalendarEvent',
      entityType: 'entry',
      entityId: entryId,
    })
    .catch((err: unknown) => {
      console.warn('[useEntries] enqueue createCalendarEvent failed', err);
    });
}

/**
 * Enqueue the Calendar PATCH-event op for an updated entry. If the entry
 * has no `googleEventId` yet, the handler falls back to a create.
 */
function enqueueUpdateCalendarEvent(entryId: string): void {
  void getSyncManager()
    .enqueue({
      op: 'updateCalendarEvent',
      entityType: 'entry',
      entityId: entryId,
    })
    .catch((err: unknown) => {
      console.warn('[useEntries] enqueue updateCalendarEvent failed', err);
    });
}

/**
 * Enqueue the cascade-delete-calendar-event op for a deleted entry. The
 * entry row has already been removed from Dexie by the time this fires;
 * we capture the `googleEventId` via the payload so the handler doesn't
 * need to look it up after the row is gone (it can't — the row is gone).
 */
function enqueueDeleteCalendarEvent(entryId: string, googleEventId: string | null): void {
  if (!googleEventId) return;
  void getSyncManager()
    .enqueue({
      op: 'deleteCalendarEvent',
      entityType: 'entry',
      entityId: entryId,
      payload: { googleEventId },
    })
    .catch((err: unknown) => {
      console.warn('[useEntries] enqueue deleteCalendarEvent failed', err);
    });
}

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
    onSuccess: (created, input) => {
      invalidateEntryViews(qc, input.date, input.cardId);
      enqueueEntryPush('create', created.id);
      enqueueCreateCalendarEvent(created.id);
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
      enqueueEntryPush('update', updated.id);
      // S12: also reflect the change in Google Calendar. The handler picks
      // the right path (create vs PATCH) based on whether `googleEventId`
      // is already populated.
      enqueueUpdateCalendarEvent(updated.id);
    },
  });
}

type DeletedEntryMeta = Awaited<ReturnType<typeof deleteEntry>>;

export function useDeleteEntryMutation(): UseMutationResult<DeletedEntryMeta, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteEntry(db, id),
    onSuccess: (deleted) => {
      // We can't know which date/card the deleted entry belonged to once it's
      // gone, so we invalidate the range prefix (which covers ALL calendar
      // grids + reports) plus the broader `['entries', 'by-date']` and
      // `['entries', 'by-card']` prefixes. Still narrower than the original
      // `['entries']` (skips e.g. `['entries', 'meta', ...]` if we add such
      // a thing later) and crucially correct for cross-day deletes.
      void qc.invalidateQueries({ queryKey: ['entries', 'range'] });
      void qc.invalidateQueries({ queryKey: ['entries', 'by-date'] });
      void qc.invalidateQueries({ queryKey: ['entries', 'by-card'] });
      if (deleted) {
        // Drive snapshot push — the tombstone written by `deleteEntry`
        // will propagate the delete to other devices.
        enqueueEntryPush('delete', deleted.id);
        // Calendar cascade — no-op in S10, real DELETE in S12.
        enqueueDeleteCalendarEvent(deleted.id, deleted.googleEventId);
      }
    },
  });
}
