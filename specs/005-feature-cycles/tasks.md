# Tasks: Break feature import cycles

**Input**: `specs/005-feature-cycles/` (spec.md, plan.md). Tests: the graph test is written first
and must fail on today's tree.

## Phase 1: Foundational

- [ ] T001 Write `apps/web/src/featureGraph.test.ts` (FR-006); run it — expect red naming the current cycles

## Phase 2: User Story 1 — one-way feature dependencies (P1) 🎯

- [ ] T002 [US1] Move `validateSnapshot`, `calendarOps`, `SyncIndicator`, `useEntriesInRange` and their tests per plan §1 (move tool)
- [ ] T003 [US1] Graph test green; gate `pnpm lint && pnpm typecheck && pnpm test`

## Phase 3: User Story 2 — auth without sync (P2)

- [ ] T004 [US2] Create `apps/web/src/app/providers/SyncOrchestrator.tsx` from the two `AuthProvider` effects; mount it in `app/routing/router.tsx`
- [ ] T005 [US2] Remove the effects and `@/features/sync/*` imports from `features/auth/AuthProvider.tsx`; update its doc comment and the router composition comment
- [ ] T006 [US2] Check SC-002 (grep)

## Phase 4: Polish

- [ ] T007 Gate + build; mark step 4 in the audit

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006 → T007
