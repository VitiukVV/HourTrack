# Tasks: Break feature import cycles

**Input**: `specs/005-feature-cycles/` (spec.md, plan.md). Tests: the graph test is written first
and must fail on today's tree.

## Phase 1: Foundational

- [X] T001 Write `apps/web/src/featureGraph.test.ts` (FR-006); run it — expect red naming the current cycles

## Phase 2: User Story 1 — one-way feature dependencies (P1) 🎯

- [X] T002 [US1] Move `validateSnapshot`, `calendarOps`, `SyncIndicator`, `useEntriesInRange` and their tests per plan §1 (move tool)
- [X] T003 [US1] Graph test green; gate `pnpm lint && pnpm typecheck && pnpm test`

## Phase 3: User Story 2 — auth without sync (P2)

- [X] T004 [US2] Create `apps/web/src/app/providers/SyncOrchestrator.tsx` from the two `AuthProvider` effects; mount it in `app/routing/router.tsx`
- [X] T005 [US2] Remove the effects and `@/features/sync/*` imports from `features/auth/AuthProvider.tsx`; update its doc comment and the router composition comment
- [X] T006 [US2] Check SC-002 (grep)

## Phase 4: Polish

- [X] T007 Gate + build; mark step 4 in the audit

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006 → T007

## Notes

- T001: red on 15 distinct cycles (rotations deduplicated). Reads sources via `import.meta.glob(?raw)` — tsconfig.app has no Node types.
- T002: 9 files moved, 19 specifiers rewritten; one cycle left (auth → sync → calendar-sync → auth), closed by T004.
- T004–T005: effects moved verbatim; log prefix `[auth]` → `[sync]`.
- T006: 0 hits. SC-001: a static, a side-effect and a dynamic back-edge each fail the test (side-effect `import 'x'` was missed at first — regex fixed).
- T007: lint, typecheck, 133 files / 1250 tests, build — pass.

## Review (stage 4)

- Code review: same-folder imports left as `@/` by the move tool → `./`; stale paths in 3 source comments and 3 live docs fixed (`docs/archive`, audit history left as is).
- Test analysis: the moved effects never had tests → `app/providers/SyncOrchestrator.test.tsx` (11 cases: once per session, no re-run on refresh, re-run after sign-out, toast matrix, rejected bootstrap, invalidation + unsubscribe). Removing the session guard fails it.
- Silent-failure hunt: graph test could pass vacuously → non-empty + known-edge guard and a synthetic cycle case; folder imports (`'../sync'`) and double quotes now counted. Bootstrap failure is still only logged (pre-existing) → step 6.
- Gate: 134 files / 1263 tests.
