# Implementation Plan: Live reads

**Spec**: `specs/006-live-reads/spec.md`

## Technical Context

`dexie-react-hooks` 4.4 (same as my-diary). `useLiveQuery` re-runs the querier after any committed
write to the tables it read (in-process and cross-tab), returns the previous answer while new deps
load, and throws querier errors during render — `useLiveRead` handles both.

## Design

1. **`useLiveRead<T>(key, query, enabled = true)`** — `useLiveQuery(async () => ({ key, ...run }), [key, enabled])`
   where `run` catches into `{ ok: false, error }`. `data` only when `answer.key === key`.
   `isLoading = enabled && !current`. The key encodes every input the closure uses.
2. **Domains**, one commit-sized batch each: settings (+ `useDefaultViewSync`, BackupSection
   `refetch` → nothing), cards (+ reorder overlay), entries (+ range buckets, by-card hook, page
   cleanup), payments/ledger, reminders, reports.
3. **Reorder overlay** — module store `{ cardId, anchor, settled }` + `useSyncExternalStore`;
   `useCardsQuery`/`useAllCardsQuery` apply it with the existing `insertionIndex`; `onMutate` sets
   it (anchor from `getCardsOrdered`), `onError` clears it, `onSuccess` marks it settled and the
   hook clears it once the live list already has the move.
4. **Bucket sharing** — `useEntriesInRange` keeps the last result in a ref; a date/card bucket whose
   entries are shallow-equal to the previous bucket keeps the previous array.
5. **Cleanup** — delete `patchEntryInRangeCaches`/`patchRangeData`, `snapshotEvents` (+ emits in
   `bootstrap`/`SyncManager`, their test), the orchestrator's invalidation effect; tests that
   asserted cache writes are rewritten to assert what the user sees (the hook's data after a write).
6. **Lint** — `pages/**` restricted from importing `db` (importNames on `@/lib/db`).

## Risks

- Re-render volume: every write re-runs mounted queries. Ranges are a month; reports a period —
  same order as today's invalidate+refetch.
- Tests rendering hooks need `waitFor` for the live answer (as for TanStack).
