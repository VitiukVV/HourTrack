# Tasks: The remaining silent failures

**Spec**: `specs/009-silent-failures/spec.md` · **Plan**: `plan.md`

## Phase 1: Foundational

- [X] T001 i18n `sync.enqueueFailed`, `db.openFailed` in `src/locales/{en,uk,es}.json`

## Phase 2: User Story 1 — sync never fails silently (P1) 🎯

- [X] T002 [US1] `src/features/sync/enqueueSync.ts` + test; switch every enqueue wrapper; entry Calendar stamp
- [X] T003 [US1] `runFlush` safety net in `src/features/sync/SyncManager.ts` + test
- [ ] T004 [US1] `initDB` failure toast in `src/main.tsx`

## Phase 3: User Story 2 — writes are reported honestly (P1)

- [ ] T005 [US2] Post-write callbacks outside the write `try` (DayPickerModal, CardModal, EntryEditor) + tests
- [ ] T006 [US2] Hook-level `onError` for entry create/delete and reminder delete; drop per-call handlers + tests
- [ ] T007 [US2] `no-floating-promises` type-aware block in `eslint.config.js`; fix ProfileSection, Login

## Phase 4: User Story 3 — a failed read is not an empty list (P2)

- [ ] T008 [US3] `isError` branches in CardsHeader, ArchivedCardsList, ReportsFilters, ReminderBell + tests

## Phase 5: Polish

- [ ] T009 Release 1.7.2: `apps/web/package.json`, `changelog.ts`, `whatsNew.releases.v1_7_2` in 3 locales
- [ ] T010 Gate + build + `pnpm e2e`; update audit §6
