# Feature Specification: Live reads instead of cache invalidation

**Feature Branch**: `feature/architecture-refactor` (step 5 of `docs/audit/2026-10-04-architecture-audit.md`)
**Created**: 2026-10-04
**Status**: Draft
**Input**: Audit A4, owner decision §5 = A (`useLiveQuery`). Dexie data is read through TanStack
Query; every write must hand-invalidate the right keys (40+ calls, a `snapshotEvents` bus for sync
pulls, a 200-line surgical range-cache patcher). A forgotten key is a stale screen (S29/UR-29-2).

## User Scenarios & Testing

### User Story 1 — every screen follows the database (Priority: P1)

Any write — a form save, a sync pull, a restore, a Calendar stamp — shows up on every mounted view
without the writer knowing who reads what.

**Independent Test**: write a row straight through the repository (no hook, no invalidation) and
see a mounted read hook return it.

**Acceptance Scenarios**:

1. **Given** the calendar is open, **When** a sync pull merges a remote entry, **Then** it appears
   with no invalidation call anywhere.
2. **Given** the reports view is open, **When** a card is renamed, **Then** the table shows the new name.
3. **Given** a read whose parameters change (day page → next day), **When** the new day is still
   loading, **Then** the hook reports loading — never the previous day's rows.

### User Story 2 — dragging a card stays put (Priority: P1)

**Independent Test**: after a drop the card is in its new slot on the very next render and never
snaps back; a failed write puts it back and says so (unchanged toasts).

### Edge Cases

- A read that throws → `isError` (as today), logged; no error-boundary crash.
- Disabled reads (no id yet) → not loading, no data (as TanStack `enabled: false`).
- Calendar cells must not all re-render on a one-entry change (S23 `memo(DayCell)` contract).

## Requirements

- **FR-001**: `lib/db/useLiveRead.ts` — `useLiveRead(key, query, enabled?)` over `useLiveQuery`,
  returning `{ data, isLoading, isSuccess, isError, error }`; data belongs to the current key only;
  query errors are caught and reported as `isError`.
- **FR-002**: Every Dexie read hook (`useCards*`, `useEntriesByDateQuery`, `useEntryByIdQuery`,
  `useEntriesInRange`, `usePaymentsByPeriodQuery`, `useMonthLedger`, `useOpenRemindersQuery`,
  `useReportData`, `useSettingsQuery`, `useDefaultViewSync`) reads through `useLiveRead`; names
  and result fields used by components are kept.
- **FR-003**: Mutations keep TanStack `useMutation` (pending/error state, toasts, sync enqueues)
  but no longer touch the query cache: no `invalidateQueries`/`setQueryData` for Dexie data.
- **FR-004**: The card reorder keeps an optimistic pending move applied over the live lists until
  Dexie reflects it; cleared (rolled back) on error.
- **FR-005**: `useEntriesInRange` reuses the previous bucket arrays whose entries are unchanged, so
  `memo(DayCell)` skips untouched days (replaces `patchEntryInRangeCaches`).
- **FR-006**: `snapshotEvents` and the `SyncOrchestrator` invalidation effect are removed.
- **FR-007**: Direct `useQuery` over Dexie in `pages/day/DayPage.tsx` and
  `features/entries/EntryEditModal.tsx` moves into a `useEntriesByCardQuery` hook in
  `features/entries`; ESLint forbids `db` imports in `pages/`.
- **FR-008**: TanStack Query remains only for network reads (`useBackupsList`) and mutations.
- **FR-009**: No user-visible change; no version bump.

## Success Criteria

- **SC-001**: `grep -E "invalidateQueries|setQueryData|getQueryData|cancelQueries"` outside
  `features/backup` → 0 in production code.
- **SC-002**: `grep -E "useQuery\("` → only `features/backup/useBackupsList.ts`.
- **SC-003**: gate + build pass; `pnpm e2e` passes (run manually).
