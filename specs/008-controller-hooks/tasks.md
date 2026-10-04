# Tasks: Controller hooks

**Spec**: `specs/008-controller-hooks/spec.md` · **Plan**: `plan.md`

## Phase 1: User Story 1 — readable components (P1) 🎯

- [X] T001 [US1] `src/features/entries/useEntryEditorController.ts` + hook test; `EntryEditor.tsx` uses it
- [X] T002 [US1] `src/features/cards/useCardFormController.ts` + hook test; `CardForm.tsx` uses it
- [X] T003 [US1] `src/features/cards/useCardsHeaderController.ts` + hook test; `CardsHeader.tsx` uses it
- [X] T004 [US1] `src/pages/day/useDayPageController.ts` + hook test; `DayPage.tsx` uses it

## Phase 2: Polish

- [X] T005 Gate + build + `pnpm e2e`; line counts for SC-001; mark step 7 in the audit

## Phase 3: Convergence

- [X] T006 Move the Calendar sync-retry handler from `EntryEditor.tsx` markup into `useEntryEditorController` (`handleRetrySync`) per SC-001 (partial)
- [X] T007 Record CardForm at 29.8 % (583 → 409) against the ≥ 30 % bar of SC-001: what remains is markup plus the rate-type option list and `selectOnFocus`, which are view concerns — accepted per SC-001 (partial)

