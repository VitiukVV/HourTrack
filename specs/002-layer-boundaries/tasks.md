# Tasks: Layer boundaries enforced by lint

**Input**: `specs/002-layer-boundaries/` (spec.md, plan.md, research.md, quickstart.md)
**Tests**: no new unit tests — the lint rule is verified by the quickstart throwaway imports
(SC-002); moved tests move with their modules. Paths are relative to the repo root.

## Phase 1: Foundational — clear today's violations (US2, blocks US1)

US2 is done first: the rules cannot be switched on while the code violates them.

- [ ] T001 [P] [US2] `git mv apps/web/src/features/calendar/calendarLocale.ts apps/web/src/lib/calendarLocale.ts`; update every importer to `@/lib/calendarLocale` — `components/ui/{DayPicker,WeekPicker,MonthPicker}.tsx`, `pages/DayPage.tsx`, `features/payments/{PaymentRow,PaymentsHeader}.tsx`, `features/reminders/ReminderBell.tsx`, `features/calendar/{MonthView,WeekView,WeekAgendaView}.tsx` (relative `./calendarLocale` → alias), plus any `vi.mock` paths in tests
- [ ] T002 [P] [US2] `git mv` `apps/web/src/components/LanguageSwitcher.tsx` and `LanguageSwitcher.test.tsx` into `apps/web/src/features/settings/`; update imports in `app/AppLayout.tsx`, `features/settings/InterfaceSection.tsx` and any test mocks; make `useSettings` import relative-local (`./useSettings`) per feature convention
- [ ] T003 [US2] Run `pnpm typecheck && pnpm test` — green before touching lint

**Checkpoint**: `grep -rn "@/features/" apps/web/src/components` returns nothing.

## Phase 2: User Story 1 — wrong-direction import fails lint (P1) 🎯

**Goal**: four edges enforced (FR-001–FR-006). **Independent test**: quickstart step 3.

- [ ] T004 [US1] In `eslint.config.js` add `srcDirs(dirs)` (alias `@/<dir>/**` + relative `**/../<dir>/**`) and `layerBoundary(files, group, message)` (ignores `**/*.test.*`), ported from my-diary
- [ ] T005 [US1] In `eslint.config.js` add edges with root-relative globs: `apps/web/src/lib/**` ↛ features/pages/app/components; `apps/web/src/features/**` ↛ pages/app; `apps/web/src/components/**` ↛ pages/app/features (one block — R1: blocks for the same rule do not merge); `apps/web/src/pages/**` ↛ `@/lib/db/schema` and `**/lib/db/schema`
- [ ] T006 [US1] In `eslint.config.js` replace the `apps/web/src/components/ui/**` ignore with the seven shadcn files (`button`, `dialog`, `dropdown-menu`, `input`, `popover`, `select`, `switch`); fix any lint findings that surface in `components/ui/{DayPicker,WeekPicker,MonthPicker,TimeInput}.tsx` without changing behaviour
- [ ] T007 [US1] Run quickstart step 3 (throwaway imports per edge, alias + relative + `import type` + test-exempt), record result in this file under Notes, revert the throwaway lines

## Phase 3: Polish

- [ ] T008 Run the gate `pnpm lint && pnpm typecheck && pnpm test` and `pnpm build`
- [ ] T009 Update `docs/audit/2026-10-04-architecture-audit.md` step 1 status (done, spec 002)

## Dependencies

T001 ∥ T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009. No version bump, no changelog
(FR-008).

## Notes
