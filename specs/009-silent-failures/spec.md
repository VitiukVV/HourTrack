# Spec 009: The remaining silent failures

**Audit**: `docs/audit/2026-10-04-architecture-audit.md` §6 · **Branch**: `feature/architecture-refactor`

## Context

Reviews of specs 006–007 found seven pre-existing holes where a failure is silent or misreported.
The owner asked to fix them all (2026-10-04).

## Clarifications (decided by the implementer)

- One shared helper `enqueueSync` replaces the per-feature `enqueue…` wrappers' `console.warn`:
  log + one toast (a fixed toast id, so a write that enqueues two ops shows one toast).
- A lost entry Calendar create/update stamps the entry `syncStatus: 'error'`, which brings up the
  editor's existing "retry sync" button. A lost Calendar *delete* cannot be retried from the UI
  (the entry is gone) — the toast is the whole remedy.
- The due-reminders banner stays hidden on a read error; the bell next to it reports it.
- A failed IndexedDB open shows a persistent toast; a failed tombstone prune stays console-only.
- `no-floating-promises` is enabled type-aware for app code (tests excluded); it costs ~3 s of lint.
- User-visible → patch bump 1.7.1 → 1.7.2 with a «What's new» entry in 3 locales.

## Requirements

- **FR-001**: Every sync enqueue goes through `enqueueSync` (log + toast `sync.enqueueFailed`);
  entry Calendar create/update failures also stamp the entry `syncStatus: 'error'`.
- **FR-002**: `SyncManager.runFlush` never leaves the status stuck at "syncing": an exception
  outside the per-op handling sets `error` and arms a retry.
- **FR-003**: A failed `initDB` shows `db.openFailed`; prune failures stay console-only.
- **FR-004**: `@typescript-eslint/no-floating-promises` is on for app code; the lint passes.
- **FR-005**: A parent callback that throws after a successful write is not reported as a save
  failure (DayPickerModal, CardModal, EntryEditor save/delete).
- **FR-006**: Entry create/delete and reminder delete report failures from hook-level `onError`;
  no per-call `onError` remains for them.
- **FR-007**: CardsHeader, ArchivedCardsList, ReportsFilters and ReminderBell show
  `common.loadFailed` on a read error instead of an empty state.

## Success Criteria

- **SC-001**: `grep -rn "console.warn('\[use[A-Za-z]*\] enqueue"` in `src` → 0.
- **SC-002**: Tests prove FR-001 (toast + stamp), FR-002, FR-005, FR-006, FR-007.
- **SC-003**: gate + build pass; `pnpm e2e` passes; i18n parity test passes.
