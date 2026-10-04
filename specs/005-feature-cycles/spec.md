# Feature Specification: Break feature import cycles

**Feature Branch**: `feature/architecture-refactor` (step 4 of `docs/audit/2026-10-04-architecture-audit.md`)
**Created**: 2026-10-04
**Status**: Draft
**Input**: Audit A1 — features import each other in both directions, so no feature can be read,
tested or changed on its own.

## Current cycles (non-test imports)

| Cycle | Edge that closes it |
|-------|---------------------|
| sync ↔ backup | `sync/SyncManager`, `sync/bootstrap` → `backup/validateSnapshot` |
| sync ↔ calendar-sync | `calendar-sync/resyncAll` → `sync/handlers/calendarOps` (which imports calendar-sync) |
| sync ↔ settings | `sync/SyncIndicator` → `settings/useSettings` |
| calendar ↔ entries | `entries/useEntries` → `calendar/useEntriesInRange` |

`auth → sync` is not a cycle but couples sign-in to Drive sync (`AuthProvider` runs the bootstrap
and the snapshot-applied invalidation).

## User Scenarios & Testing

### User Story 1 — features depend on each other in one direction only (Priority: P1)

As the maintainer I can open any feature and know that nothing it imports imports it back.

**Independent Test**: a test builds the feature-level import graph from non-test sources and fails
on any cycle.

**Acceptance Scenarios**:

1. **Given** the four cycles above, **When** step 4 is done, **Then** the graph test passes.
2. **Given** a future change that adds a back-edge, **When** tests run, **Then** the graph test
   names the cycle.

### User Story 2 — sign-in knows nothing about sync (Priority: P2)

**Independent Test**: `features/auth` has no import from `features/sync`; sync still bootstraps once
per signed-in session and pulled data still reaches the UI.

### Edge Cases

- Silent token refresh must not re-run the bootstrap (session-keyed guard, as today).
- Sign-out then sign-in in the same tab bootstraps again.

## Requirements

- **FR-001**: `validateSnapshot` (+ test) moves to `lib/sync/` — it depends only on zod, shared
  types and `lib/db/constants`.
- **FR-002**: `sync/handlers/calendarOps` (+ tests) moves to `features/calendar-sync/` so
  calendar-sync owns its Calendar ops; `SyncManager` keeps dispatching to them (sync →
  calendar-sync only). A handler registry (audit §4) is not used: registration by import side
  effect adds an ordering hazard (handlers must exist before the first flush) for no current gain.
- **FR-003**: `SyncIndicator` (+ test) moves to `features/backup/` — its only consumer is
  `BackupSection`.
- **FR-004**: `useEntriesInRange` (+ test) moves to `features/entries/`.
- **FR-005**: `app/providers/SyncOrchestrator.tsx` takes over from `AuthProvider` the
  bootstrap-once-per-session effect (with its toasts) and the snapshot-applied cache
  invalidation; it is mounted inside `AuthProvider` next to `AutoBackupScheduler`.
- **FR-006**: `apps/web/src/featureGraph.test.ts` fails on any cycle between `features/*` folders
  (non-test files, static and dynamic imports).
- **FR-007**: No user-visible change; no version bump.

## Success Criteria

- **SC-001**: The feature graph test passes and fails when a back-edge is added locally.
- **SC-002**: `grep "features/sync" features/auth` (non-test) → 0.
- **SC-003**: `pnpm lint && pnpm typecheck && pnpm test` and `pnpm build` pass.

## Assumptions

- Test files may import across features (fixtures, fakes); the graph checks production code only.
