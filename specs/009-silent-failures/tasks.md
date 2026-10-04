# Tasks: The remaining silent failures

**Spec**: `specs/009-silent-failures/spec.md` · **Plan**: `plan.md`

## Phase 1: Foundational

- [X] T001 i18n `sync.enqueueFailed`, `db.interrupted.openFailed` in `src/locales/{en,uk,es}.json`

## Phase 2: User Story 1 — sync never fails silently (P1) 🎯

- [X] T002 [US1] `src/features/sync/enqueueSync.ts` + test; switch every enqueue wrapper; entry Calendar stamp
- [X] T003 [US1] `runFlush` safety net in `src/features/sync/SyncManager.ts` + test
- [X] T004 [US1] `initDB` failure → DB-interrupted screen (`openFailed`) in `src/main.tsx`, `lib/db/dbStatus.ts`

## Phase 3: User Story 2 — writes are reported honestly (P1)

- [X] T005 [US2] Post-write callbacks outside the write `try` (DayPickerModal, CardModal, EntryEditor) + tests
- [X] T006 [US2] Hook-level `onError` for entry create/delete and reminder delete; drop per-call handlers + tests
- [X] T007 [US2] `no-floating-promises` type-aware block in `eslint.config.js`; fix ProfileSection, Login

## Phase 4: User Story 3 — a failed read is not an empty list (P2)

- [X] T008 [US3] `isError` branches in CardsHeader, ArchivedCardsList, ReportsFilters, ReminderBell + tests

## Phase 5: Polish

- [X] T009 Release 1.7.2: `apps/web/package.json`, `changelog.ts`, `whatsNew.releases.v1_7_2` in 3 locales
- [X] T010 Gate + build + `pnpm e2e`; update audit §6
