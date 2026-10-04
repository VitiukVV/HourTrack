# Tasks: Data layer split into repositories

**Input**: `specs/004-db-repositories/` (spec.md, plan.md). Tests: existing data-layer tests are
the net; new tests only for new functions (`resetCalendarSyncFields`, unified prune default).

## Phase 1: Foundational

- [ ] T001 Move `apps/web/src/features/sync/retention.ts` → `apps/web/src/lib/sync/retention.ts` (move tool), update importers
- [ ] T002 Create `apps/web/src/lib/db/mutate.ts` (`nowIso`, `patchRow`, `deleteWithTombstone`) with unit tests `lib/db/mutate.test.ts` written first

## Phase 2: User Story 1 — one repository per domain (P1) 🎯

- [ ] T003 [US1] Cut `lib/db/queries.ts` sections into `lib/db/repos/{settings,cards,cardOrder,entries,payments,reminders,syncQueue,tombstones}.ts`; `queries.ts` becomes the `export *` barrel
- [ ] T004 [US1] Use `patchRow` in `updateEntry/updatePayment/updateReminder` and `deleteWithTombstone` in `deleteEntry/deletePayment/deleteReminder`; replace local `nowIso` copies
- [ ] T005 [US1] Gate: `pnpm lint && pnpm typecheck && pnpm test` — existing data-layer tests unchanged

## Phase 3: User Story 2 — no write bypasses the data layer (P1)

- [ ] T006 [US2] Test first, then add `resetCalendarSyncFields(db)` to `repos/entries.ts`; use it in `features/settings/CalendarSection.tsx`
- [ ] T007 [US2] `pruneOldTombstones(db, keepDays = TOMBSTONE_TTL_DAYS, now)` in `repos/tombstones.ts`; delete `features/sync/pruneTombstones.ts`, move its test to `lib/db/pruneTombstones.test.ts`; `main.tsx` and `SyncManager.ts` call `pruneOldTombstones(db)`
- [ ] T008 [US2] Check SC-003: `grep` for table writes outside `lib/db` (only `lib/google/tokenStore.ts` allowed)

## Phase 4: Polish

- [ ] T009 Gate + build; mark step 3 in the audit

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006 ∥ T007 → T008 → T009

## Notes
