# Tasks: Mark paid from a cleaning's card

**Spec**: `specs/010-entry-mark-paid/spec.md` · **Plan**: `plan.md` · Paths under `apps/web/` unless noted.
Each task ships with its tests (test-first).

## Phase 1: Foundational — payment ↔ entry link

- [X] T001 Add optional `entryId?: string | null` to `Payment` in `packages/shared-types/src/payment.ts`; accept it in `paymentSchema` in `src/lib/sync/validateSnapshot.ts` (+ test: a snapshot with and without `entryId` validates and round-trips)
- [X] T002 `listEntryLinkedPayments(db)` in `src/lib/db/repos/payments.ts` (+ export from `src/lib/db/index.ts`, + repo test incl. duplicate → earliest `createdAt` wins in the hook); `usePaymentsByEntry()` → `Map<entryId, Payment>` in `src/features/payments/usePayments.ts` (+ hook test)

## Phase 2: User Story 1 — record a payment from a cleaning (P1) 🎯 MVP

- [X] T003 [US1] `MarkPaidDialog`: optional `entryId` (stamped on create) and `defaultPaidOn` (create-mode date prefill) in `src/features/payments/MarkPaidDialog.tsx` (+ tests; Payments-page behaviour unchanged)
- [X] T004 [US1] `src/features/payments/EntryPaymentControl.tsx`: «Paid» button for non-monthly cards → dialog prefilled with saved earnings, entry date, entry month, entry id (+ test: hidden for monthly; prefill values; created payment carries `entryId`/`period`)
- [X] T005 [US1] Render `EntryPaymentControl` in `src/features/entries/EntryEditor.tsx` under the earnings line; i18n keys `payments.entry.*` in `src/locales/{en,uk,es}.json` (+ EntryEditor test)

## Phase 3: User Story 2 — see / change a cleaning's payment (P2)

- [X] T006 [US2] `EntryPaymentControl` shows «Paid €X» for a linked payment and opens the dialog in edit mode (+ test)
- [X] T007 [US2] «Remove payment» with confirm in `MarkPaidDialog` edit mode → `useDeletePaymentMutation`; keys `payments.dialog.remove*` (+ test: card offers «Paid» again)

## Phase 4: User Story 3 — paid mark on the calendar (P3)

- [X] T008 [US3] `EntryChip` `paid?: boolean` → check-badge icon with `aria-label={t('calendar.paid')}` in `bar` and `row` variants in `src/features/calendar/EntryChip.tsx` (+ test)
- [X] T009 [US3] Thread `paid` from `usePaymentsByEntry()` in `MonthView.tsx`/`WeekView.tsx` through `DayCell.tsx`/`WeekAgendaView.tsx` (+ view tests)

## Phase 5: Polish

- [X] T010 Release 1.8.0: `apps/web/package.json`, `src/features/whats-new/changelog.ts`, `whatsNew.releases.v1_8_0` in 3 locales
- [X] T011 Gate `pnpm lint && pnpm typecheck && pnpm test`; run quickstart from `plan.md` on `localhost:5173` — gate green; browser quickstart left to the owner (Chrome extension could not reach localhost)

## Dependencies

T001 → T002 → US1 (T003 → T004 → T005) → US2 (T006, T007) ; US3 (T008 → T009) needs only T002.
Parallel: T008 can run alongside T003–T007 (different files).
MVP = Phase 1 + US1.
