import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { Entry } from '@hourtrack/shared-types';
import { compareEntriesForDisplay } from '@hourtrack/shared-utils';

import {
  createEntry,
  db,
  deleteEntry,
  getEntriesByDate,
  getEntryById,
  updateEntry,
} from '@/lib/db';
import type { EntriesInRangeData } from '@/features/calendar/useEntriesInRange';
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
 *   - Mutations narrow-invalidate the entry query subtrees that can be
 *     affected by the write:
 *       • `['entries', 'range', ...]`     — calendar grid (S23: surgically
 *                                           patched in place instead of
 *                                           invalidated, except for the
 *                                           Reports subtree which carries
 *                                           an aggregated `byCard` /
 *                                           `totals` shape that's cheaper
 *                                           to recompute than to patch).
 *       • `['entries', 'by-date', date]`  — DayPage list
 *       • `['entries', 'by-card', cardId]`— per-card history (e.g. fixed-rate
 *                                           proportional split in EntryEditor)
 */

// ---------------------------------------------------------------------------
// Surgical cache patcher (S23 Part C)
// ---------------------------------------------------------------------------

/**
 * Reports-range subtree discriminator. Range query keys come in two shapes:
 *
 *   - calendar surfaces: `['entries', 'range', start, end]` (4 elements)
 *   - reports surfaces:  `['entries', 'range', 'reports', start, end,
 *                          showArchived, selectedKey]` (7 elements)
 *
 * We can't patch the Reports shape in place — its cached value is the
 * `ReportData` aggregation (`byEntry`, `byCard`, `totals`) and rebuilding
 * those touches `computeReport`, monthly-retainer math, and card-filter
 * resolution. So Reports caches are INVALIDATED on every entry mutation;
 * calendar caches are PATCHED. The `'reports'` marker at index 2 is what
 * distinguishes them.
 *
 * TanStack v5's `setQueriesData` partial-match would otherwise call our
 * patcher for both — so the patcher itself checks the marker and returns
 * `old` (no-op) for Reports keys, and the post-mutation invalidate scopes
 * to `['entries', 'range', 'reports']` so calendar caches don't get
 * dropped from cache.
 */
function isReportsRangeKey(queryKey: QueryKey): boolean {
  return Array.isArray(queryKey) && queryKey[2] === 'reports';
}

interface CalendarRangeKey {
  start: string;
  end: string;
}

/**
 * Extract the inclusive `[start, end]` YYYY-MM-DD pair from a calendar
 * range query key. Returns `null` when the key shape is unexpected (Reports
 * keys, dev-time noise, etc.); callers fall through to a no-op patch.
 */
function rangeFromKey(queryKey: QueryKey): CalendarRangeKey | null {
  if (!Array.isArray(queryKey)) return null;
  if (queryKey.length !== 4) return null;
  if (queryKey[0] !== 'entries' || queryKey[1] !== 'range') return null;
  const start = queryKey[2];
  const end = queryKey[3];
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  return { start, end };
}

/**
 * Pure update of an `EntriesInRangeData` cache value, given a single entry
 * change. Returns `old` unchanged when the date doesn't fall inside the
 * range (the cache is irrelevant to this mutation) or when the operation
 * is a no-op for this range (e.g. an update where the entry was never in
 * the range AND still isn't).
 *
 * The three operation shapes:
 *
 *   - **create**: insert `entry` into the date + card buckets, re-sorting
 *                 with `compareEntriesForDisplay` so render order matches
 *                 `getEntriesByDateRange`'s contract (S32). Both derived
 *                 maps inherit that order because they are rebuilt from
 *                 `nextEntries` below — the card buckets matter as much as
 *                 the date ones, since `dayClickAction` deletes whichever
 *                 entry sits first in the card bucket.
 *
 *   - **delete**: remove `entry.id` from every bucket where it appears.
 *                 If the entry was never in this range, return `old`.
 *
 *   - **update**: remove the OLD shape (looked up by id across the
 *                 `entries` array), then insert the new shape if the new
 *                 `date` still falls in the range. Crucially this handles
 *                 the date-change case (entry moved May 14 → May 21) by
 *                 removing the entry from the old date's bucket and
 *                 inserting at the new — both buckets need updates even
 *                 inside a single range query.
 *
 * Buckets are created fresh (new arrays / new Maps for the touched keys)
 * so any consumer that compares by reference (e.g. `memo(DayCell)`)
 * correctly sees ONLY the touched buckets as changed. Untouched buckets
 * keep their original array reference — that's the contract that makes
 * `memo(DayCell)`'s comparator effective.
 */
function patchRangeData(
  old: EntriesInRangeData | undefined,
  entry: Entry,
  op: 'create' | 'update' | 'delete',
): EntriesInRangeData | undefined {
  if (!old) return old;

  // Look up the entry's prior shape from the cached array (id-based). We
  // need this for the "remove from old bucket" branch of update + delete.
  const priorIndex = old.entries.findIndex((e) => e.id === entry.id);
  const prior = priorIndex >= 0 ? old.entries[priorIndex] : null;

  // Does the new entry's date fall inside this cache's window?
  const inRangeNow = entry.date >= old.start && entry.date <= old.end;

  // If this range never saw the entry AND won't see it, nothing to do.
  if (!prior && !inRangeNow) return old;

  // Build the next array.
  let nextEntries: Entry[];
  if (op === 'delete') {
    if (!prior) return old; // never in this range
    nextEntries = old.entries.filter((e) => e.id !== entry.id);
  } else if (op === 'create') {
    if (!inRangeNow) return old; // creates outside the window don't touch us
    // Insert and re-sort so a new entry lands at its chronological position
    // instead of being appended (matches `getEntriesByDateRange`).
    nextEntries = [...old.entries, entry].sort(compareEntriesForDisplay);
  } else {
    // op === 'update'. Three sub-cases:
    //   (1) prior in range, new still in range  → replace in array
    //   (2) prior in range, new out of range    → remove
    //   (3) prior NOT in range, new in range    → insert (rare — covers a
    //       date-change that moved the entry into a cache that hadn't
    //       previously seen it). This is correct: a single update can
    //       toggle membership in multiple range caches.
    const withoutPrior = prior ? old.entries.filter((e) => e.id !== entry.id) : old.entries;
    if (inRangeNow) {
      // Re-sorting here is what makes an edited start time reorder the day
      // immediately, with no refetch — this patch is the path that renders
      // right after a save.
      nextEntries = [...withoutPrior, entry].sort(compareEntriesForDisplay);
    } else {
      nextEntries = withoutPrior;
    }
  }

  // Rebuild the two derived Maps. We could do this incrementally for the
  // touched buckets only, but the entry counts per range cache are
  // bounded (~30-50 days × a handful of entries each), so a fresh O(N)
  // pass keeps the helper simple and still untouched-bucket-stable: the
  // construction order is deterministic and each non-touched bucket ends
  // up as a brand-new array, BUT the cache value is being replaced
  // anyway. The reference-stability optimisation that matters most for
  // `memo(DayCell)` is at the QueryClient level: setQueriesData replaces
  // the whole cache value, so DayCell re-receives a new `entriesByDate`
  // Map — but only DayCells whose individual bucket VALUES differ
  // re-render (the comparator checks `prev.entries === next.entries`,
  // and untouched buckets keep their array identity below).
  //
  // To preserve per-bucket identity for untouched dates, we copy old
  // buckets verbatim and only construct fresh arrays for the dates whose
  // contents actually changed (the old date and/or the new date for an
  // update; just the new date for create; just the old date for delete).

  const touchedDates = new Set<string>();
  const touchedCards = new Set<string>();
  if (prior) {
    touchedDates.add(prior.date);
    touchedCards.add(prior.cardId);
  }
  if (op !== 'delete') {
    touchedDates.add(entry.date);
    touchedCards.add(entry.cardId);
  }

  const nextEntriesByDate = new Map<string, Entry[]>();
  for (const [date, bucket] of old.entriesByDate) {
    if (!touchedDates.has(date)) {
      nextEntriesByDate.set(date, bucket);
    }
  }
  const nextEntriesByCard = new Map<string, Entry[]>();
  for (const [cardId, bucket] of old.entriesByCard) {
    if (!touchedCards.has(cardId)) {
      nextEntriesByCard.set(cardId, bucket);
    }
  }
  // Now populate the touched buckets fresh from `nextEntries`.
  for (const e of nextEntries) {
    if (touchedDates.has(e.date)) {
      const bucket = nextEntriesByDate.get(e.date);
      if (bucket) bucket.push(e);
      else nextEntriesByDate.set(e.date, [e]);
    }
    if (touchedCards.has(e.cardId)) {
      const bucket = nextEntriesByCard.get(e.cardId);
      if (bucket) bucket.push(e);
      else nextEntriesByCard.set(e.cardId, [e]);
    }
  }

  return {
    start: old.start,
    end: old.end,
    entries: nextEntries,
    entriesByDate: nextEntriesByDate,
    entriesByCard: nextEntriesByCard,
    cardsById: old.cardsById, // cards lookup is owned by useEntriesInRange
  };
}

/**
 * Walk every cached `['entries', 'range', ...]` calendar query and apply
 * the entry change in place via `patchRangeData`. Reports range caches
 * (`['entries', 'range', 'reports', ...]`) are SKIPPED — those are
 * separately invalidated by the mutation hooks because the cached value
 * is an aggregation that's cheaper to recompute than to patch.
 *
 * Implementation: we walk the query cache directly with `findAll` instead
 * of `setQueriesData`. TanStack v5's `setQueriesData` Updater signature
 * doesn't expose the matched query's full key, so we'd have no way to
 * tell a calendar key from a Reports key inside the closure. `findAll`
 * + per-query `setQueryData` gives us both the discriminator check and
 * the surgical patch in a single pass.
 *
 * Exported for tests; consumed only by the three mutation hooks below.
 */
export function patchEntryInRangeCaches(
  qc: QueryClient,
  entry: Entry,
  op: 'create' | 'update' | 'delete',
): void {
  const matches = qc.getQueryCache().findAll({ queryKey: ['entries', 'range'] });
  for (const query of matches) {
    if (isReportsRangeKey(query.queryKey)) continue;
    if (!rangeFromKey(query.queryKey)) continue;
    qc.setQueryData<EntriesInRangeData>(query.queryKey, (old) =>
      old ? patchRangeData(old, entry, op) : old,
    );
  }
}

/**
 * Invalidate every Reports range cache. Mirrors the pattern documented
 * above: Reports stores an aggregated `ReportData` shape; rebuilding
 * `byCard` + `totals` (especially with monthly-retainer per-entry
 * denominators) from a single-entry patch would duplicate ~100 LOC of
 * `computeReport` logic. Invalidate + refetch is the correct trade.
 */
function invalidateReportsRange(qc: QueryClient): void {
  void qc.invalidateQueries({
    queryKey: ['entries', 'range', 'reports'],
    // Match the Reports subtree exactly (prefix match). TanStack v5
    // default `predicate` semantics already do prefix match on the array
    // key, so the 3-element prefix catches every Reports query
    // regardless of the trailing (start, end, showArchived, selectedKey).
  });
}

export function useEntriesByDateQuery(date: string): UseQueryResult<Entry[]> {
  return useQuery({
    queryKey: ['entries', 'by-date', date],
    queryFn: () => getEntriesByDate(db, date),
  });
}

/**
 * S17 — single-entry query used by `EntryEditModal` to load the entry the
 * user clicked from the calendar surface. The query is `enabled` only when
 * an `id` is supplied so the hook can be called unconditionally with
 * `null` (idle modal state).
 *
 * Cache key shares the `['entries', 'by-id', id]` prefix so future entry
 * mutations could narrow-invalidate just this entry's view if needed. For
 * now mutations invalidate ranges + by-date + by-card, all of which already
 * cover any displayed surface; this hook just refetches when the active
 * range cache invalidates because TanStack will re-run on `staleTime: 0`.
 */
export function useEntryByIdQuery(
  id: string | null | undefined,
): UseQueryResult<Entry | undefined> {
  return useQuery({
    queryKey: ['entries', 'by-id', id],
    queryFn: () => (id ? getEntryById(db, id) : Promise.resolve(undefined)),
    enabled: !!id,
  });
}

type EntryCreateInput = Omit<Entry, 'createdAt' | 'updatedAt'>;

export function useCreateEntryMutation(): UseMutationResult<Entry, Error, EntryCreateInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EntryCreateInput) => createEntry(db, input),
    onSuccess: (created, input) => {
      // S23 — surgical: patch the new entry into every calendar range cache
      // whose [start, end] contains the entry's date. Out-of-range caches
      // are left byte-identical, so untouched DayCells (with `memo()`)
      // skip re-rendering.
      patchEntryInRangeCaches(qc, created, 'create');
      // Reports caches still invalidate because their cached value is an
      // aggregation (see `invalidateReportsRange` doc).
      invalidateReportsRange(qc);
      // by-date and by-card invalidations stay: they're consumed by
      // DayPage (full per-day list) and EntryEditor's per-card history
      // respectively. Patching them surgically is possible but the
      // payoff is small compared to the calendar grid and the surface
      // doesn't mount during the calendar-surface critical path.
      void qc.invalidateQueries({ queryKey: ['entries', 'by-date', input.date] });
      void qc.invalidateQueries({ queryKey: ['entries', 'by-card', input.cardId] });
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
      // S23 — surgical. If the user changed the date (May 14 → May 21),
      // patchRangeData removes from the old bucket AND inserts at the new
      // bucket inside any range cache that touches either date.
      patchEntryInRangeCaches(qc, updated, 'update');
      invalidateReportsRange(qc);
      // The S17 EntryEditModal reads the entry through `useEntryByIdQuery`
      // (`['entries', 'by-id', id]`) which is NOT covered by the range /
      // by-date / by-card invalidations above. Without this write a user
      // who reopens the edit modal right after saving sees the pre-edit
      // form values because the by-id cache still holds the stale row
      // (`reset(...)` runs inside EntryEditor on its own snapshot, but the
      // next mount of EntryEditor seeds RHF from this cached entry).
      qc.setQueryData<Entry | undefined>(['entries', 'by-id', updated.id], updated);
      void qc.invalidateQueries({ queryKey: ['entries', 'by-date', updated.date] });
      void qc.invalidateQueries({ queryKey: ['entries', 'by-card', updated.cardId] });
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
      if (deleted) {
        // S23 — surgical. We synthesise the minimum entry shape needed by
        // `patchRangeData`: id (for lookup), date (for in-range test),
        // cardId (for the byCard bucket). The rest of the Entry shape
        // is irrelevant to the patch since we're removing the row.
        //
        // `deleteEntry` returns `Pick<Entry, 'id' | 'cardId' | 'date' |
        // 'googleEventId'>` (see queries.ts:362). We coerce to Entry for
        // the patcher signature; the missing fields are never read on
        // the delete path.
        patchEntryInRangeCaches(qc, deleted as unknown as Entry, 'delete');
        invalidateReportsRange(qc);
        void qc.invalidateQueries({ queryKey: ['entries', 'by-date', deleted.date] });
        void qc.invalidateQueries({ queryKey: ['entries', 'by-card', deleted.cardId] });
        // Drive snapshot push — the tombstone written by `deleteEntry`
        // will propagate the delete to other devices.
        enqueueEntryPush('delete', deleted.id);
        // Calendar cascade — no-op in S10, real DELETE in S12.
        enqueueDeleteCalendarEvent(deleted.id, deleted.googleEventId);
      } else {
        // Entry didn't exist (idempotent delete). Cache state is already
        // consistent with reality; nothing to do.
      }
    },
  });
}
