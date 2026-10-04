# Tasks: Data layer split into repositories

**Input**: `specs/004-db-repositories/` (spec.md, plan.md). Tests: existing data-layer tests are
the net; new tests only for new functions (`resetCalendarSyncFields`, unified prune default).

## Phase 1: Foundational

- [X] T001 Move `apps/web/src/features/sync/retention.ts` → `apps/web/src/lib/sync/retention.ts` (move tool), update importers
- [X] T002 Create `apps/web/src/lib/db/mutate.ts` (`nowIso`, `patchRow`, `deleteWithTombstone`) with unit tests `lib/db/mutate.test.ts` written first

## Phase 2: User Story 1 — one repository per domain (P1) 🎯

- [X] T003 [US1] Cut `lib/db/queries.ts` sections into `lib/db/repos/{settings,cards,cardOrder,entries,payments,reminders,syncQueue,tombstones}.ts`; `queries.ts` becomes the `export *` barrel
- [X] T004 [US1] Use `patchRow` in `updateEntry/updatePayment/updateReminder` and `deleteWithTombstone` in `deleteEntry/deletePayment/deleteReminder`; replace local `nowIso` copies
- [X] T005 [US1] Gate: `pnpm lint && pnpm typecheck && pnpm test` — existing data-layer tests unchanged

## Phase 3: User Story 2 — no write bypasses the data layer (P1)

- [X] T006 [US2] Test first, then add `resetCalendarSyncFields(db)` to `repos/entries.ts`; use it in `features/settings/CalendarSection.tsx`
- [X] T007 [US2] `pruneOldTombstones(db, keepDays = TOMBSTONE_TTL_DAYS, now)` in `repos/tombstones.ts`; delete `features/sync/pruneTombstones.ts`, move its test to `lib/db/pruneTombstones.test.ts`; `main.tsx` and `SyncManager.ts` call `pruneOldTombstones(db)`
- [X] T008 [US2] Check SC-003: `grep` for table writes outside `lib/db` (only `lib/google/tokenStore.ts` allowed)

## Phase 4: Polish

- [X] T009 Gate + build; mark step 3 in the audit

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006 ∥ T007 → T008 → T009

## Notes

- T001: `retention.ts` moved to `lib/sync` (lib may not import features).
- T002: `mutate.test.ts` written first (6 cases, red on missing module); Dexie generics need `Table<T, string, TInsert>` — `EntityTable<T, 'id'>` does not unify with a generic `T`.
- T003: split by the existing section headers with a script; card ordering went to `repos/cardOrder.ts` (cards → cardOrder only, no cycle). Largest repo: `cards.ts` 288 lines.
- T004: `updateEntry/Payment/Reminder` → `patchRow`, `deleteEntry/Payment/Reminder` → `deleteWithTombstone`; error messages unchanged (asserted by existing tests). `updateCard` keeps its own body (plan).
- T006: `resetCalendarSyncFields` test-first (2 cases); keeps the old no-`updatedAt` behaviour, now documented.
- T007: test-first — the moved prune test failed against the 30-day default, passes on `TOMBSTONE_TTL_DAYS` (180). `features/sync/pruneTombstones.ts` deleted.
- T008: writes outside `lib/db` only in `lib/google/tokenStore.ts` and `lib/sync/snapshot.ts` `applySnapshot` — both sanctioned in SC-003.
- T009: lint, typecheck, 132 files / 1247 tests, build — pass.

## Review (stage 4)

- Code review: no findings ≥80. Test analysis: added the SyncManager prune-window test (fails on a regression to 30 days) and the `deleteWithTombstone` rollback test; renamed the explicit-`keepDays` test.
- Silent-failure hunt: `patchRow`'s `validate` documented as synchronous; prune comments now say "before each push".
- Deferred to step 6 (write-failure handling), pre-existing: Calendar disconnect clears `hourtrackCalendarId` before resetting entries, so a failed reset leaves the user "disconnected" with stale event ids and no retry. Fix: one transaction (`disconnectCalendar`) + a `CalendarSection` test.
