# Tasks: Write failures are never silent

**Spec**: `specs/007-write-failures/spec.md` · **Plan**: `plan.md`

## Phase 1: Foundational

- [X] T001 i18n `common.saveFailed`, `common.unexpectedError` in `src/locales/{en,uk,es}.json`

## Phase 2: User Story 1 — a failed write says so (P1) 🎯

- [X] T002 [US1] Settings hook `onError` toast + test in `src/features/settings/useSettings.test.tsx`; LanguageSwitcher/InterfaceSection callers
- [X] T003 [US1] `disconnectCalendar` transaction in `src/lib/db/repos/settings.ts` + rollback test; CalendarSection uses it
- [X] T004 [US1] Scheduler done/notified `onError` in `src/features/reminders/RemindersScheduler.tsx` + test
- [X] T005 [US1] Global `unhandledrejection` toast in `src/app/installUnhandledRejectionToast.ts` + test; wire in `src/main.tsx`
- [X] T006 [US1] ESLint rule against `void …mutateAsync(` in `eslint.config.js` + rows in `src/layerBoundaries.test.ts`; fix `ArchivedCardsList`

## Phase 3: User Story 2 — a failed read is not mistaken for "loading" or "deleted" (P2)

- [ ] T007 [US2] `src/features/entries/DayPickerModal.tsx` and `EntryEditModal.tsx` error branches + tests

## Phase 4: Polish

- [ ] T008 Release 1.7.1: `apps/web/package.json`, `changelog.ts`, `whatsNew.releases.v1_7_1` in 3 locales
- [ ] T009 Gate + build + `pnpm e2e`; mark step 6 in the audit
