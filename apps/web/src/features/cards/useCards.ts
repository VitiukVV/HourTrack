import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { Card } from '@hourtrack/shared-types';

import i18n from '@/lib/i18n/i18n';
import {
  archiveCard,
  createCard,
  db,
  deleteCardPermanently,
  getArchivedCardsOrdered,
  getCardById,
  getCardsOrdered,
  reorderCard,
  restoreCard,
  updateCard,
  type CardCreateInput,
} from '@/lib/db';
import { useLiveRead, type LiveRead } from '@/lib/db/useLiveRead';
import { enqueueSync } from '@/features/sync/enqueueSync';

import { resolveReorderAnchor } from './cardReorder';

/**
 * Notify the SyncManager that a card change should be pushed to Drive.
 * Fire-and-forget — the manager handles debounce, retry, and offline; a
 * failed enqueue is reported by `enqueueSync`. `toastKey` swaps in copy
 * specific to the caller's change.
 */
function enqueueCardPush(
  mutation: 'create' | 'update' | 'delete',
  cardId: string,
  toastKey?: string,
): void {
  enqueueSync(
    {
      op: 'pushDataJson',
      mutation,
      entityType: 'card',
      entityId: cardId,
    },
    'useCards',
    { toastKey },
  );
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
  enqueueSync(
    {
      op: 'bulkUpdateCardEvents',
      entityType: 'card',
      entityId: cardId,
    },
    'useCards',
  );
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
 * Hooks for Cards. Each hook wraps a pure DB function and passes the singleton
 * `db` from `@/lib/db`. NEVER import or call the singleton directly inside the
 * pure functions — they take it as their first argument so tests can construct
 * isolated `HourTrackDB(<name>)` instances.
 *
 * Reads are live (spec 006): every list — the header row, the archive, the
 * calendar's `cardsById`, the reports filter — re-reads after any card write,
 * whoever made it. Mutations only write and enqueue sync.
 */

type ReorderAnchor = ReturnType<typeof resolveReorderAnchor>;

/**
 * The drop the user just made, laid over the live lists until Dexie reflects
 * it (spec 006 FR-004). Without it the chip would snap back to its old slot
 * for the frames between the drop and the live re-read. Module state because
 * every mounted list must show the same order.
 */
interface PendingMove {
  cardId: string;
  anchor: ReorderAnchor;
  /** The card's stored rank when the drag started. */
  positionBefore: number | undefined;
  /** The write has committed; the overlay goes once a live read shows it. */
  settled: boolean;
}

/** Last resort for a move whose rank came back unchanged (a no-op drop). */
const SETTLED_OVERLAY_MAX_MS = 2000;

let pendingMove: PendingMove | null = null;
const pendingListeners = new Set<() => void>();

function setPendingMove(next: PendingMove | null): void {
  pendingMove = next;
  pendingListeners.forEach((listener) => listener());
}

function subscribePendingMove(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => pendingListeners.delete(listener);
}

/**
 * Where the moved card re-enters one list, given the anchor computed over the
 * active row. `null` means there is no anchor (an empty or single-card row), so
 * the card is appended. An anchor this particular list does not contain clamps
 * to the front — a guess that lasts only until the overlay is cleared.
 */
function insertionIndex(list: Card[], anchor: ReorderAnchor): number {
  if (anchor === null) return list.length;
  const at = list.findIndex((c) => c.id === anchor.id);
  return Math.max(0, at + (anchor.side === 'after' ? 1 : 0));
}

/**
 * `list` with the pending move applied. Patched relative to the anchor CARD,
 * not a raw index: the all-cards list also holds archived cards, so an
 * active-row index would land in the wrong slot there.
 */
function applyMove(list: Card[], move: PendingMove | null): Card[] {
  if (!move) return list;
  const from = list.findIndex((c) => c.id === move.cardId);
  if (from === -1) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(insertionIndex(next, move.anchor), 0, moved!);
  return next;
}

function useWithPendingMove(read: LiveRead<Card[]>): LiveRead<Card[]> {
  const move = useSyncExternalStore(subscribePendingMove, () => pendingMove);
  const data = useMemo(() => read.data && applyMove(read.data, move), [read.data, move]);

  // Cleared on evidence that the live read has caught up with storage — the
  // card's rank moved (or the card is gone) — NOT on the order matching the
  // overlay: a sync pull landing in the same tick would never match, and the
  // overlay would pin a stale order for the session.
  useEffect(() => {
    if (!move?.settled || !read.data) return;
    const row = read.data.find((c) => c.id === move.cardId);
    if (!row || row.position !== move.positionBefore) setPendingMove(null);
  }, [move, read.data]);

  return { ...read, data };
}

export function useCardsQuery(): LiveRead<Card[]> {
  // 001-cards-order-colors: the header row IS the user's order, so this read
  // goes through the ordered helper. Every list that renders cards does the
  // same — one order everywhere (spec US3).
  return useWithPendingMove(useLiveRead('cards:active', () => getCardsOrdered(db, false)));
}

export function useArchivedCardsQuery(): LiveRead<Card[]> {
  return useLiveRead('cards:archived', () => getArchivedCardsOrdered(db));
}

/**
 * Returns ALL cards (active + archived when `includeArchived = true`). Used by:
 *   - DayPage (S06): orphan-card safety — entries may reference cards that have
 *     since been archived, so the row needs the card record to render the chip.
 *   - Reports (S07): "Show archived" toggle expands the multi-select pool to
 *     include archived cards.
 */
export function useAllCardsQuery(includeArchived: boolean): LiveRead<Card[]> {
  return useWithPendingMove(
    useLiveRead(`cards:all:${includeArchived}`, () => getCardsOrdered(db, includeArchived)),
  );
}

export function useCardQuery(id: string | null | undefined): LiveRead<Card | undefined> {
  return useLiveRead(`cards:id:${id ?? ''}`, () => getCardById(db, id!), !!id);
}

/**
 * `CardCreateInput` comes from the query layer, where `position` is optional:
 * the row's rank is assigned by `nextCardPosition`, not by the form.
 */
export function useCreateCardMutation(): UseMutationResult<Card, Error, CardCreateInput> {
  return useMutation({
    mutationFn: (input: CardCreateInput) => createCard(db, input),
    onSuccess: (created) => enqueueCardPush('create', created.id),
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
  return useMutation({
    mutationFn: (id: string) => archiveCard(db, id),
    onSuccess: (updated) => {
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
  return useMutation({
    mutationFn: (id: string) => restoreCard(db, id),
    onError: (err, id) => {
      // `ArchivedCardsList` fires this via `mutate`, so this is the only
      // place a failed restore surfaces: otherwise the button flickers, the
      // card stays in the archive, and every retry does the same thing. The
      // archive list is the only place the user can act on such a card, so
      // the failure has to name something they can do.
      console.error(`[useCards] restore failed for card ${id}:`, err);
      toast.error(i18n.t('cards.restoreFailed'));
    },
    onSuccess: (updated) => {
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
 * "Delete permanently" affordance. The calendar/day-page/reports reads pick
 * up the cascade on their own (live reads).
 */
export function useDeleteCardMutation(): UseMutationResult<void, Error, string> {
  return useMutation({
    mutationFn: (id: string) => deleteCardPermanently(db, id),
    onSuccess: (_void, deletedId) => {
      // The query layer already wrote tombstones for the card AND each
      // cascaded entry — the sync push will pick them up automatically.
      enqueueCardPush('delete', deletedId);
    },
  });
}

interface ReorderCardArgs {
  cardId: string;
  /** Target index among the ACTIVE cards, as dropped by the user. */
  toIndex: number;
}

/**
 * 001-cards-order-colors — move a card to a new slot in the user's own order.
 *
 * Optimistic by necessity: the chip has already visually landed where the
 * user dropped it, so the move is laid over every live list immediately
 * (`PendingMove`) and dropped if the write fails. `reorderCard` writes exactly
 * one row (the midpoint rank of the new neighbours), which is what lets two
 * devices reorder different cards while offline and both keep their move.
 *
 * It deliberately does NOT enqueue `bulkUpdateCardEvents`: a reorder changes
 * nothing about any Calendar event, and that op PATCHes every event of the
 * card. Only `name`/`color` edits earn that cascade.
 */
export function useReorderCardsMutation(): UseMutationResult<number, Error, ReorderCardArgs> {
  return useMutation({
    onMutate: async ({ cardId, toIndex }: ReorderCardArgs) => {
      // The neighbour the card is landing next to, computed once over the
      // ACTIVE row as stored — every list is then patched relative to it.
      const activeRow = await getCardsOrdered(db, false);
      setPendingMove({
        cardId,
        anchor: resolveReorderAnchor(activeRow, cardId, toIndex),
        positionBefore: activeRow.find((c) => c.id === cardId)?.position,
        settled: false,
      });
    },
    mutationFn: ({ cardId, toIndex }: ReorderCardArgs) => reorderCard(db, cardId, toIndex),
    onError: (err) => {
      // Put the row back exactly as stored, then say so — silently leaving a
      // wrong order on screen would be worse than the failed move itself.
      setPendingMove(null);
      console.error('[useCards] reorder failed:', err);
      toast.error(i18n.t('cards.reorder.failed'));
    },
    onSuccess: (_position, { cardId }) => {
      // The overlay stays until a live read shows the committed rank (see
      // `useWithPendingMove`), so the chip never snaps back in between.
      const move = pendingMove;
      if (move?.cardId === cardId) {
        setPendingMove({ ...move, settled: true });
        setTimeout(() => {
          if (pendingMove?.cardId === cardId && pendingMove.settled) setPendingMove(null);
        }, SETTLED_OVERLAY_MAX_MS);
      }
      // The rank does not change how an entry renders — no
      // `bulkUpdateCardEvents`.
      enqueueCardPush('update', cardId, 'cards.reorder.syncFailed');
    },
  });
}

/** Test seam: drop any pending move between tests. */
export function _resetPendingMoveForTesting(): void {
  setPendingMove(null);
}
