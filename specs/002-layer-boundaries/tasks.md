# Tasks: Layer boundaries enforced by lint

**Input**: `specs/002-layer-boundaries/` (spec.md, plan.md, research.md, quickstart.md)
**Tests**: no new unit tests — the lint rule is verified by the quickstart throwaway imports
(SC-002); moved tests move with their modules. Paths are relative to the repo root.

## Phase 1: Foundational — clear today's violations (US2, blocks US1)

US2 is done first: the rules cannot be switched on while the code violates them.

- [X] T001 [P] [US2] `git mv apps/web/src/features/calendar/calendarLocale.ts apps/web/src/lib/calendarLocale.ts`; update every importer to `@/lib/calendarLocale` — `components/ui/{DayPicker,WeekPicker,MonthPicker}.tsx`, `pages/DayPage.tsx`, `features/payments/{PaymentRow,PaymentsHeader}.tsx`, `features/reminders/ReminderBell.tsx`, `features/calendar/{MonthView,WeekView,WeekAgendaView}.tsx` (relative `./calendarLocale` → alias), plus any `vi.mock` paths in tests
- [X] T002 [P] [US2] `git mv` `apps/web/src/components/LanguageSwitcher.tsx` and `LanguageSwitcher.test.tsx` into `apps/web/src/features/settings/`; update imports in `app/AppLayout.tsx`, `features/settings/InterfaceSection.tsx` and any test mocks; make `useSettings` import relative-local (`./useSettings`) per feature convention
- [X] T003 [US2] Run `pnpm typecheck && pnpm test` — green before touching lint

**Checkpoint**: `grep -rn "@/features/" apps/web/src/components` returns nothing.

## Phase 2: User Story 1 — wrong-direction import fails lint (P1) 🎯

**Goal**: four edges enforced (FR-001–FR-006). **Independent test**: quickstart step 3.

- [X] T004 [US1] In `eslint.config.js` add `srcDirs(dirs)` (alias `@/<dir>/**` + relative `**/../<dir>/**`) and `layerBoundary(files, group, message)` (ignores `**/*.test.*`), ported from my-diary
- [X] T005 [US1] In `eslint.config.js` add edges with root-relative globs: `apps/web/src/lib/**` ↛ features/pages/app/components; `apps/web/src/features/**` ↛ pages/app; `apps/web/src/components/**` ↛ pages/app/features (one block — R1: blocks for the same rule do not merge); `apps/web/src/pages/**` ↛ `@/lib/db/schema` and `**/lib/db/schema`
- [X] T006 [US1] In `eslint.config.js` replace the `apps/web/src/components/ui/**` ignore with the seven shadcn files (`button`, `dialog`, `dropdown-menu`, `input`, `popover`, `select`, `switch`); fix any lint findings that surface in `components/ui/{DayPicker,WeekPicker,MonthPicker,TimeInput}.tsx` without changing behaviour
- [X] T007 [US1] Run quickstart step 3 (throwaway imports per edge, alias + relative + `import type` + test-exempt), record result in this file under Notes, revert the throwaway lines

## Phase 3: Polish

- [X] T008 Run the gate `pnpm lint && pnpm typecheck && pnpm test` and `pnpm build`
- [X] T009 Update `docs/audit/2026-10-04-architecture-audit.md` step 1 status (done, spec 002)

## Dependencies

T001 ∥ T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009. No version bump, no changelog
(FR-008).

## Notes

- T006: linting `components/ui/TimeInput.tsx` raised 2 `react-refresh/only-export-components` warnings (pure helpers exported from a component file, imported by features). `minutesToHHMM` / `parseHHMM` moved to `apps/web/src/lib/timeOfDay.ts` with their unit tests (`lib/timeOfDay.test.ts`); `EntryChip` and `ReminderBell` import them from there.
- T007 (SC-002): throwaway imports gave one error each — lib alias, lib relative, features `import type` from app, components → features, pages → schema (5/5); the same import in `lib/date.test.ts` gave none. Reverted.
- T008: lint, typecheck, web tests 129 files / 1220 tests, build — all pass.

## Review (stage 4)

Agents: code-reviewer (no findings ≥80), pr-test-analyzer, silent-failure-hunter.

- Fixed: automated regression test for the edges — `apps/web/src/layerBoundaries.test.ts`
  (ESLint API, 19 cases; written red first: 6 failed before the fix).
- Fixed: bare directory imports (`@/app`, `@/features`), the src-root shell files (`App`, `main`)
  and dynamic `import()` were not covered — `layerBoundary()` now takes src-relative targets and
  also emits a `no-restricted-syntax` `ImportExpression` selector.
- Fixed: wrong comment in `features/settings/LanguageSwitcher.tsx` (claimed a toast on failure).
- Deferred to audit step 3/5: pages can still reach raw `db` via the `@/lib/db` barrel
  (`pages/DayPage.tsx`); FR-004 restricts the schema module only. Rule message reworded to say so.
- Deferred to audit step 6: the `LanguageSwitcher` write failure is silent (console only) —
  pre-existing; a toast is a user-visible change.
