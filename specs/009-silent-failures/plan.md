# Implementation Plan: The remaining silent failures

**Spec**: `specs/009-silent-failures/spec.md`

## Design

1. **`features/sync/enqueueSync.ts`** — `enqueueSync(op, tag, { onFailure?, toastKey? })`:
   `getSyncManager().enqueue(op).catch` → `console.error`, `toast.error(i18n.t(toastKey ??
   'sync.enqueueFailed'), { id: 'sync-enqueue-failed' })`, `onFailure?.(err)`. Used by
   `useEntries`, `useCards` (reorder keeps its `cards.reorder.syncFailed` copy), `usePayments`,
   `useReminders`, `useSettings`, `CalendarSection`, the editor's retry. Entry Calendar
   create/update pass `onFailure` → `updateEntry(db, id, { syncStatus: 'error', syncError })`.
2. **`runFlush`** — body moves to `runFlushOnce`; `runFlush` wraps it in `try/catch` →
   `setStatus('error', msg)` + `armRetry` (its own failure only logged).
3. **`main.tsx`** — `dbReady = initDB(db)`; prune chained with its own log; after render
   `dbReady.catch` → log + `toast.error(db.openFailed, { duration: Infinity })`.
4. **Lint** — type-aware block (`projectService`) for `src/**` non-test with
   `no-floating-promises`; `void navigate(…)` in ProfileSection and Login.
5. **Post-write callbacks** — write in its own `try`, callbacks after it; EntryEditor uses the
   two-argument `then`.
6. **Hook-level `onError`** — `useCreateEntryMutation` (`entries.saveFailed`),
   `useDeleteEntryMutation` (`entries.deleteFailed`), `useDeleteReminderMutation`
   (`reminders.actionFailed`); callers drop their own.
7. **Read errors** — the four consumers branch on `isError` first.
8. **Release** — 1.7.2, changelog, `sync.enqueueFailed`, `db.openFailed`, release copy ×3.
