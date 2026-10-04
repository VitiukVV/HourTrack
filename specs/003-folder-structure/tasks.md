# Tasks: Folder structure of app, pages and lib

**Input**: `specs/003-folder-structure/` (spec.md, plan.md). Tests: existing suite only — the
change is a move; the unchanged test count (1239) is the regression signal.

## Phase 1: User Story 1 — modules grouped by role (P1) 🎯

- [X] T001 [US1] Write the rewrite tool `move-modules.mjs` in the session scratchpad (plan §Research)
- [X] T002 [US1] Move `apps/web/src/app/*` into `shell/`, `routing/`, `providers/` per plan move map and rewrite references
- [X] T003 [US1] Move `apps/web/src/pages/*` into one folder per section and rewrite references
- [X] T004 [US1] Move loose `apps/web/src/lib/*` files into `i18n/`, `utils/`, `ui/` and rewrite references
- [X] T005 [US1] Fix non-module paths by hand: `import.meta.glob` in `lib/utils/noAutofill.test.ts`, `apps/web/components.json` `aliases.utils`
- [X] T006 [US1] Gate: `pnpm lint && pnpm typecheck && pnpm test` (1239 web tests) and `pnpm build`; SC-002 listing check

## Phase 2: Polish

- [X] T007 Mark step 2 done in `docs/audit/2026-10-04-architecture-audit.md`

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006 → T007 (one rewrite pass may cover T002–T004).

## Notes

- T002–T004 ran as one pass of the rewrite tool: 43 files moved, 158 specifiers rewritten in 101 files.
- T005: noAutofill glob → `../../**/*.tsx`; components.json `utils` → `@/lib/utils/utils`; the fixture string in `layerBoundaries.test.ts` updated to the new path.
- T006: lint, typecheck, 130 files / 1239 tests (unchanged), build, `test:coverage` thresholds (lines 88%, branches 75%) — pass. No loose files under app/pages/lib.
