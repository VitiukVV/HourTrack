# Tasks: Live reads instead of cache invalidation

**Input**: `specs/006-live-reads/` (spec.md, plan.md). `useLiveRead` is written test-first; each
domain batch ends with the gate.

## Phase 1: Foundational

- [X] T001 Add `dexie-react-hooks`; write `apps/web/src/lib/db/useLiveRead.test.tsx` (live update after a direct write, no stale data on key change, error → isError, disabled) then `lib/db/useLiveRead.ts`

## Phase 2: User Story 1 — reads follow the database (P1) 🎯

- [X] T002 [US1] Settings: `features/settings/useSettings.ts`, `features/calendar/useDefaultViewSync.ts`, `features/backup/BackupSection.tsx` (drop `refetch`)
- [X] T003 [US1] Reminders: `features/reminders/useReminders.ts`
- [X] T004 [US1] Payments: `features/payments/usePayments.ts` (period list + ledger)
- [X] T005 [US1] Entries: `features/entries/useEntries.ts`, `useEntriesInRange.ts` (bucket sharing, FR-005), new `useEntriesByCardQuery`; `pages/day/DayPage.tsx`, `features/entries/EntryEditModal.tsx`
- [X] T006 [US1] Reports: `features/reports/useReportData.ts`
- [X] T007 [US1] Remove `features/sync/snapshotEvents.ts` (+ emits, test) and the invalidation effect in `app/providers/SyncOrchestrator.tsx`

## Phase 3: User Story 2 — reorder stays put (P1)

- [ ] T008 [US2] Cards: `features/cards/useCards.ts` reads + mutations + reorder overlay (FR-004); rewrite cache assertions in `useCards.test.tsx`

## Phase 4: Polish

- [ ] T009 ESLint: `pages/**` may not import `db` from `@/lib/db`; extend `layerBoundaries.test.ts`
- [ ] T010 SC-001/SC-002 greps; gate + build; `pnpm e2e`; mark step 5 in the audit

## Dependencies

T001 → T002…T008 (any order, gate after each) → T009 → T010
