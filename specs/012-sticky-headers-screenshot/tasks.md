# Tasks: Pinned Payments header, card filter above the Reports title

**Spec**: `spec.md` · **Plan**: `plan.md`. Each task ships with its tests (test-first).

## Phase 1: User Story 1 — pinned Payments header (P1)

- [ ] T001 [US1] `src/features/payments/PaymentsHeader.tsx` root is a pinned bar under the top bar (`sticky top-[var(--ht-sticky-chrome,0px)] z-10 bg-background border-b`) (+ test in `PaymentsHeader.test.tsx`)

## Phase 2: User Story 2 — Reports card row on top (P1)

- [ ] T002 [US2] `src/features/reports/ReportsFilters.tsx`: card section first, `heading` slot, then the pinned period section; wrapper `contents` so the bar pins for the whole page; `src/pages/reports/Reports.tsx` passes the title as `heading` (+ order/contents tests in `ReportsFilters.test.tsx`)

## Phase 3: Polish

- [ ] T003 Release 1.10.1: `package.json`, `changelog.ts`, `whatsNew.releases.v1_10_1` + guide items for Payments/Reports in uk/en/es
- [ ] T004 Gate `pnpm lint && pnpm typecheck && pnpm test`

## Dependencies

T001, T002 independent; T003 after both; T004 last.
