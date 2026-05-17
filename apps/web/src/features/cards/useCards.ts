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
 * Enqueue a bulk PATCH of every synced Calendar event belonging to the
 * card. Triggered when the card's `name` or `color` changes — both affect
 * the event title and/or colorId, so all linked events must follow.
 *
 * Other field changes (rate, defaultNote, defaultDurationMin) do NOT
 * change event titles/colors directly — they only affect FUTURE entries'
 * earnings rendering, so we skip the bulk PATCH in those cases to avoid
 * unnecessary Calendar API calls.
 */
function enqueueBulkUpdateCardEvents(cardId: string): void {
  void getSyncManager()
    .enqueue({
      op: 'bulkUpdateCardEvents',
      entityType: 'card',
      entityId: cardId,
    })
    .catch((err: unknown) => {
      console.warn('[useCards] enqueue bulkUpdateCardEvents failed', err);
    });
}

/**
 * Returns true when the patch produces a real change to a field that affects
 * the rendered Calendar event (title or colorId). Today: `name` and `color`.
 * If new event-relevant fields are added in the future (e.g. a per-card
 * emoji), extend this guard.
 *
 * S16b: explicitly does NOT include `defaultStartMinutes`. The default is a
 * template for the NEXT new entry, not a retroactive law — existing entries
 * keep their own `startMinutes`, so a change to the card-level default must
 * not cascade into a bulk-PATCH of every linked Calendar event.
 *
 * The diff check against `existing` matters when callers pass a patch shape
 * that contains `name`/`color` set to the SAME value as the current row (a
 * common pattern when the editor sends the whole form back). Without the
 * diff, a `defaultStartMinutes`-only edit submitted alongside an unchanged
 * `name` field would spuriously trigger a bulk Calendar PATCH — wasting API
 * budget and racing event-content updates the user never asked for.
 */
function patchAffectsCalendarEvents(
  patch: { name?: string; color?: string },
  existing: Card,
): boolean {
  if ('name' in patch && patch.name !== existing.name) return true;
  if ('color' in patch && patch.color !== existing.color) return true;
  return false;
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
      // Same race-fix rationale as `useUpdateCardMutation`: write the new
      // card into the active-list cache synchronously so the chip carousel
      // and day-click flow see it on the very next render, not after the
      // background refetch resolves. Walk every cached `['cards', ...]`
      // list query (active + all + by-id detail) and append the row.
      qc.setQueriesData<Card[] | Card | undefined>({ queryKey: ['cards'] }, (old) => {
        if (Array.isArray(old)) {
          return [...old, created];
        }
        return old;
      });
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
      // useEntriesInRange / useReportData bundle a `cardsById` snapshot into
      // their query result. Without invalidating the range prefix here, a
      // newly-created card the user immediately activates would not appear
      // in the day-click flow's cardsById lookup — `dayClickAction` would
      // then fall back to `open-picker` even though a card IS active.
      void qc.invalidateQueries({ queryKey: ['entries', 'range'] });
      enqueueCardPush('create', created.id);
    },
  });
}

interface UpdateCardArgs {
  id: string;
  patch: Partial<Omit<Card, 'id' | 'createdAt' | 'updatedAt'>>;
}

interface UpdateCardMutationContext {
  /** Pre-update snapshot of the card row; used by `onSuccess` to diff the
   *  patch against the pre-state so we only fire cascading side-effects when
   *  values actually changed (see `patchAffectsCalendarEvents`). */
  previous: Card | undefined;
}

export function useUpdateCardMutation(): UseMutationResult<
  Card,
  Error,
  UpdateCardArgs,
  UpdateCardMutationContext
> {
  const qc = useQueryClient();
  return useMutation<Card, Error, UpdateCardArgs, UpdateCardMutationContext>({
    // S16b: read the card BEFORE the mutation runs so `onSuccess` can diff
    // the patch against the pre-state. This is what powers the
    // "defaultStartMinutes-only edit doesn't cascade to a bulk Calendar
    // PATCH" rule — see `patchAffectsCalendarEvents`.
    onMutate: async ({ id }: UpdateCardArgs) => {
      const previous = await getCardById(db, id);
      return { previous };
    },
    mutationFn: ({ id, patch }: UpdateCardArgs) => updateCard(db, id, patch),
    onSuccess: (updated, vars, context) => {
      // Write the updated card straight into every cached cards list BEFORE
      // invalidating. Without this, a user who reopens the edit modal
      // immediately after saving can see the pre-edit values because
      // `useCardsQuery` is still serving the stale cached array until its
      // background refetch resolves — and react-hook-form's `defaultValues`
      // only reads at form mount, so by the time the refetch lands the form
      // has already initialized from stale data.
      //
      const patchList = (old: Card[] | undefined): Card[] | undefined =>
        old?.map((c) => (c.id === updated.id ? updated : c));
      qc.setQueryData<Card[]>(ACTIVE_KEY, patchList);
      qc.setQueryData<Card[]>(ARCHIVED_KEY, patchList);
      qc.setQueryData<Card[]>(['cards', 'all', true] as const, patchList);
      qc.setQueryData<Card[]>(['cards', 'all', false] as const, patchList);
      qc.setQueryData<Card | undefined>(['cards', 'by-id', updated.id], updated);
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
      // Range queries embed a `cardsById` snapshot — refresh so name/color/
      // defaults edits propagate to the calendar grid + reports table.
      void qc.invalidateQueries({ queryKey: ['entries', 'range'] });
      enqueueCardPush('update', updated.id);
      // S12/S16b: only bulk-PATCH every synced event for this card when the
      // patch produced a real change to a field that affects how events
      // render (title from `name`, colorId from `color`). A patch that only
      // changes `defaultStartMinutes` — or any other non-event-rendering
      // field — does NOT cascade. The diff against `context.previous`
      // protects against spurious cascades when the caller submits the
      // whole form (including unchanged name/color).
      const previous = context?.previous;
      if (previous && patchAffectsCalendarEvents(vars.patch, previous)) {
        enqueueBulkUpdateCardEvents(updated.id);
      }
    },
  });
}

export function useArchiveCardMutation(): UseMutationResult<Card, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveCard(db, id),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
      // Range queries embed a `cardsById` snapshot — refresh so the archived
      // state flips immediately in the calendar grid + reports table.
      void qc.invalidateQueries({ queryKey: ['entries', 'range'] });
      // Archive is treated as an update from the sync POV: the row stays
      // in `cards[]` with `isArchived: true`. No tombstone is needed.
      enqueueCardPush('update', updated.id);
      // S12 cascade-delete-on-archive (S10 carry-over followup): per spec
      // Notes #6 "cascade delete is one-way (app → Calendar)". The bulk
      // handler reads `card.isArchived` at dispatch time and switches
      // its branch — patch (active) vs delete (archived). One op covers
      // both cases.
      enqueueBulkUpdateCardEvents(updated.id);
    },
  });
}

export function useRestoreCardMutation(): UseMutationResult<Card, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreCard(db, id),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
      // Range queries embed a `cardsById` snapshot — refresh so the restored
      // card flips back to non-archived in the calendar grid + reports table.
      void qc.invalidateQueries({ queryKey: ['entries', 'range'] });
      enqueueCardPush('update', updated.id);
      // S12 restore-from-archive: the archive cascade deleted all remote
      // events and cleared `googleEventId` for every entry on the card.
      // Restoring does NOT automatically recreate events — the bulk
      // handler skips entries with `googleEventId = null`, so the
      // enqueue below is a no-op in the post-archive state. Events
      // come back the next time the user edits each entry (the
      // resulting `updateCalendarEvent` op falls back to a create when
      // `googleEventId` is null).
      //
      // This is intentional v1 behaviour: a "recreate-all-events-on-
      // restore" path would multiply Calendar API calls on every
      // accidental archive+restore. S13 followup: add an explicit
      // "Re-sync this card's events" affordance in the archive UI for
      // users who want events back immediately.
      //
      // We still enqueue the bulk op so that any entries the user
      // manually re-edited DURING the archived state (which would have
      // failed because `card.isArchived === true` blocked nothing local
      // but the calendar handler saw the archived state) get their
      // `synced` status re-stamped on restore.
      enqueueBulkUpdateCardEvents(updated.id);
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
