# Tasks: Adjust a month's expected amount

**Spec**: `spec.md` · **Plan**: `plan.md`. Each task ships with its tests (test-first).

## Phase 1: Foundational — entity, storage, sync

- [X] T001 `MonthAdjustment` type in `src/shared/types/monthAdjustment.ts`, `monthAdjustmentId()` in `src/shared/utils/month-adjustment.ts`; `'monthAdjustment'` in `TombstoneEntityType`
- [X] T002 Dexie v10 store `monthAdjustments` in `src/lib/db/schema.ts`; repo `src/lib/db/repos/monthAdjustments.ts` (get-all / by-period / in-periods / set upsert keeping `createdAt` + amount guard / delete with tombstone), exported via `queries.ts` + `index.ts` (+ repo test, + upgrade test that v9 data survives)
- [X] T003 `deleteCardPermanently` cascades adjustments with tombstones in `src/lib/db/repos/cards.ts` (+ test)
- [X] T004 Snapshot v7: `DriveSnapshot.monthAdjustments` + schemaVersion 7 in `src/shared/types/snapshot.ts`; `validateSnapshot` accepts 7, backfills `[]`, row schema, tombstone enum; `buildSnapshot`/`applySnapshot` (replace + merge) in `src/lib/sync/snapshot.ts`; `lwwMerge` merges by LWW + tombstones (+ tests: v6 file restores with none; round-trip; LWW; reset not revived)

## Phase 2: User Story 1 — set the month's expected amount (P1) 🎯 MVP

- [X] T005 [US1] `calculatedMonthTotal` in `src/shared/utils/earnings.ts`; `computeMonthLedger` takes `adjustments`, rows gain `calculated` / `adjusted` (+ ledger tests: override, status paid, totals, other month untouched, €0)
- [X] T006 [US1] `useMonthLedger` reads the period's adjustments; `useSetMonthAdjustmentMutation` / `useDeleteMonthAdjustmentMutation` enqueue a Drive push, in `src/features/payments/useMonthAdjustments.ts` (+ hook test)
- [X] T007 [US1] `expectedAmountSchema` + `ExpectedAmountDialog.tsx` (save, validation, failure toast keeps sheet open) (+ test)
- [ ] T008 [US1] `PaymentRow`: expected amount opens the dialog; i18n `payments.expected.*`, `payments.validation.expected*` in uk/en/es (+ row test)

## Phase 3: User Story 2 — adjusted mark and reset (P2)

- [ ] T009 [US2] Adjusted row shows «€X · calc. €Y» (`payments.row.calculated`); dialog shows «Reset to calculated» only when adjusted → delete mutation (+ tests)

## Phase 4: User Story 4 — Reports follow the adjustment (P2)

- [ ] T010 [US4] `adjustedEntryShares` in `src/shared/utils/earnings.ts` (+ tests: proportional, mixed custom, €0 calculated → even split, sum = amount)
- [ ] T011 [US4] `computeReport` takes `adjustments` (byEntry / byCard / totals / monthlyContribution) (+ tests: month, week inside month, range spanning two months, monthly + hourly cards)
- [ ] T012 [US4] `useReportData` reads adjustments in range and widens scope when any exist (+ hook test)

## Phase 5: Polish

- [ ] T013 Release 1.10.0: `package.json`, `src/features/whats-new/changelog.ts`, `whatsNew.releases.v1_10_0` in 3 locales
- [ ] T014 Gate `pnpm lint && pnpm typecheck && pnpm test`; quickstart from `plan.md`

## Dependencies

T001 → T002 → (T003, T004) ; T002 → T005 → T006 → T007 → T008 → T009 ; T005 → T010 → T011 → T012.
US3 (cross-device/backups) is delivered by T002–T004. MVP = Phase 1 + US1.
