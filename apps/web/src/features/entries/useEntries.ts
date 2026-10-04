import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import type { Entry } from '@hourtrack/shared-types';

import {
  createEntry,
  db,
  deleteEntry,
  getEntriesByCardId,
  getEntriesByDate,
  getEntryById,
  updateEntry,
} from '@/lib/db';
import { useLiveRead, type LiveRead } from '@/lib/db/useLiveRead';
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
 * Hooks for Entry CRUD, mirroring the S03 cards-hook conventions: each hook
 * wraps a pure DB helper and passes the singleton `db`. Reads are live
 * (spec 006) — the calendar range, the day list, the per-card history and the
 * edit modal all re-read after any entry write, including a date move that
 * leaves one day and lands on another. Mutations only write and enqueue sync.
 */

export function useEntriesByDateQuery(date: string): LiveRead<Entry[]> {
  return useLiveRead(`entries:date:${date}`, () => getEntriesByDate(db, date));
}

/**
 * S17 — single-entry read used by `EntryEditModal` to load the entry the
 * user clicked from the calendar surface. Disabled until an `id` is supplied
 * so the hook can be called unconditionally with `null` (idle modal state).
 */
export function useEntryByIdQuery(id: string | null | undefined): LiveRead<Entry | undefined> {
  return useLiveRead(`entries:id:${id ?? ''}`, () => getEntryById(db, id!), !!id);
}

/**
 * Every entry of one card, across the whole DB. `EntryEditor` needs the full
 * per-card set for the fixed-rate proportional earnings split (DayPage and
 * EntryEditModal).
 */
export function useEntriesByCardQuery(cardId: string | null | undefined): LiveRead<Entry[]> {
  return useLiveRead(
    `entries:card:${cardId ?? ''}`,
    () => getEntriesByCardId(db, cardId!),
    !!cardId,
  );
}

type EntryCreateInput = Omit<Entry, 'createdAt' | 'updatedAt'>;

export function useCreateEntryMutation(): UseMutationResult<Entry, Error, EntryCreateInput> {
  return useMutation({
    mutationFn: (input: EntryCreateInput) => createEntry(db, input),
    onSuccess: (created) => {
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
  return useMutation({
    mutationFn: ({ id, patch }: UpdateEntryArgs) => updateEntry(db, id, patch),
    onSuccess: (updated) => {
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
  return useMutation({
    mutationFn: (id: string) => deleteEntry(db, id),
    onSuccess: (deleted) => {
      // `null` = the entry was already gone (idempotent delete): nothing to sync.
      if (!deleted) return;
      // Drive snapshot push — the tombstone written by `deleteEntry` will
      // propagate the delete to other devices.
      enqueueEntryPush('delete', deleted.id);
      enqueueDeleteCalendarEvent(deleted.id, deleted.googleEventId);
    },
  });
}
