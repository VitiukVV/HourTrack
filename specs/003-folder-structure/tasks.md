# Tasks: Folder structure of app, pages and lib

**Input**: `specs/003-folder-structure/` (spec.md, plan.md). Tests: existing suite only — the
change is a move; the unchanged test count (1239) is the regression signal.

## Phase 1: User Story 1 — modules grouped by role (P1) 🎯

- [ ] T001 [US1] Write the rewrite tool `move-modules.mjs` in the session scratchpad (plan §Research)
- [ ] T002 [US1] Move `apps/web/src/app/*` into `shell/`, `routing/`, `providers/` per plan move map and rewrite references
- [ ] T003 [US1] Move `apps/web/src/pages/*` into one folder per section and rewrite references
- [ ] T004 [US1] Move loose `apps/web/src/lib/*` files into `i18n/`, `utils/`, `ui/` and rewrite references
- [ ] T005 [US1] Fix non-module paths by hand: `import.meta.glob` in `lib/utils/noAutofill.test.ts`, `apps/web/components.json` `aliases.utils`
- [ ] T006 [US1] Gate: `pnpm lint && pnpm typecheck && pnpm test` (1239 web tests) and `pnpm build`; SC-002 listing check

## Phase 2: Polish

- [ ] T007 Mark step 2 done in `docs/audit/2026-10-04-architecture-audit.md`

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006 → T007 (one rewrite pass may cover T002–T004).

## Notes
