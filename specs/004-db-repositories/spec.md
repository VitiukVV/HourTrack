# Feature Specification: Data layer split into repositories

**Feature Branch**: `feature/architecture-refactor`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Owner 2026-10-04 — step 3 of `docs/audit/2026-10-04-architecture-audit.md` (A3, A5):
`lib/db/queries.ts` is a 1030-line monolith over 7 domains; a few writes bypass it. Split it into
a shared mutation core + one repository per domain (as my-diary spec 004), keep `queries.ts` as a
re-export barrel, and route the bypasses through the repositories. Internal refactor, no
behaviour change, no version bump, no «Що нового».

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Change one domain's data access in one place (Priority: P1)

A developer changing how payments are stored opens one payments repository, not a 1000-line
file, and the rules every write must follow (timestamps, tombstones) live in one shared core.

**Why this priority**: The next steps (live-query reads, cycle removal) add per-domain reads;
they need a per-domain home.

**Independent Test**: every existing data-layer test passes unchanged, importing from the same
paths as today.

**Acceptance Scenarios**:

1. **Given** the data layer, **When** a developer looks for card writes, **Then** they are in
   the cards repository and use the shared core for stamping and deletion tombstones.
2. **Given** existing imports from `@/lib/db` and `@/lib/db/queries`, **When** the split lands,
   **Then** they compile and behave identically.

### User Story 2 - No write bypasses the data layer (Priority: P1)

Every IndexedDB write outside `lib/db` goes through a repository function.

**Why this priority**: The audit found a component bulk-updating entries directly and a second,
duplicate tombstone pruner — exactly the drift a single data layer prevents.

**Independent Test**: no table write outside `lib/db` except the two owners named in SC-003.

**Acceptance Scenarios**:

1. **Given** Settings → disconnect Google Calendar, **When** the user confirms, **Then** entries'
   calendar-sync fields are reset by a repository function, with the same result as today.
2. **Given** expired tombstones, **When** pruning runs at boot or after a push, **Then** one
   repository function with one retention constant does it.

### Edge Cases

- Transaction scope stays identical (same tables per transaction), so atomicity guarantees of
  S29/S31 (atomic get→merge→put, settings read-modify-write) are preserved.
- Validation errors keep their exact messages (tests assert on them).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A shared mutation core in `lib/db` MUST provide the timestamp helper, the
  atomic get→merge→stamp→put update, and delete-with-tombstone; repositories MUST use it instead
  of repeating the pattern.
- **FR-002**: `queries.ts` MUST be split into repositories: settings, cards, entries, payments,
  reminders, sync queue, tombstones. `queries.ts` stays as a barrel; `lib/db/index.ts` exports
  stay the same.
- **FR-003**: The calendar-disconnect reset in `features/settings/CalendarSection.tsx` MUST move
  to a repository function.
- **FR-004**: Tombstone pruning MUST have one implementation with one retention constant
  (`TOMBSTONE_TTL_DAYS`, 180 days), used at boot and after a push. This fixes a drift found
  during planning: `SyncManager` pruned local tombstones at a hard-coded 30 days while
  `retention.ts` ("both must agree") and the merge use 180 — the only intended behaviour change
  of this step (not user-visible).
- **FR-005**: Apart from FR-004, public function names, signatures, error messages and transaction scopes MUST stay
  the same (beyond FR-003/FR-004 additions).
- **FR-006**: No user-visible change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Gate + build pass; existing tests pass without edits other than import paths.
- **SC-002**: No file split out of `queries.ts` (`mutate.ts`, `repos/*`) exceeds ~300 lines.
  `schema.ts` (496, the Dexie version/migration history) is out of scope.
- **SC-003**: Zero direct table writes outside `lib/db` except two sanctioned owners:
  `lib/google/tokenStore.ts` (device-local `authTokens`, never synced) and
  `lib/sync/snapshot.ts` `applySnapshot` (writes LWW-merged rows verbatim — a repository stamp
  would corrupt the merge).

## Assumptions

- Reads that features do through `db` directly (`calendarOps` settings/entry reads) are left for
  step 5 (live-query reads) — this step is about writes and the file split.
- Sync-op enqueueing stays in the feature hooks / SyncManager as today (unlike my-diary, writes
  here do not notify sync from the data layer); moving it is out of scope.
