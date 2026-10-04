# Implementation Plan: Layer boundaries enforced by lint

**Branch**: `feature/architecture-refactor` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary

Add a `layerBoundary()` helper to the root `eslint.config.js` (port of my-diary's) and four
`no-restricted-imports` blocks for the edges in FR-001–FR-004. Narrow the `components/ui/**`
ignore to the seven shadcn files. Move `calendarLocale.ts` to `lib/` and `LanguageSwitcher` to
`features/settings/` so the code passes the new rules. No runtime change.

## Technical Context

**Language/Version**: TypeScript 6, React 19
**Primary Dependencies**: ESLint 9 flat config (root `eslint.config.js`, used by `apps/web` via
`eslint . --max-warnings=0`), typescript-eslint
**Storage**: N/A
**Testing**: Vitest (`pnpm test`), lint gate, `pnpm build`
**Target Platform**: PWA (Vite)
**Project Type**: web app in a pnpm/turbo monorepo
**Constraints**: zero behaviour change; lint runs with `--max-warnings=0`, so newly linted files
(the project's own `components/ui/*Picker.tsx`, `TimeInput.tsx`) must be warning-free.
**Scale/Scope**: 1 config file, 2 moved modules (+2 tests), ~10 import updates

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template — no project gates. Project rules from
`CLAUDE.local.md` apply: verification gate `pnpm lint && pnpm typecheck && pnpm test`; internal
change → no version bump / changelog. Pass.

## Project Structure

### Documentation (this feature)

```text
specs/002-layer-boundaries/
├── spec.md, plan.md, research.md, quickstart.md, tasks.md
└── checklists/ (requirements.md, refactor.md)
```

No `data-model.md` (no data) and no `contracts/` (no external interface).

### Source Code

```text
eslint.config.js                                   # + layerBoundary(), 4 edges, narrowed ignore
apps/web/src/lib/calendarLocale.ts                 # ← features/calendar/calendarLocale.ts
apps/web/src/features/settings/LanguageSwitcher.tsx       # ← components/LanguageSwitcher.tsx
apps/web/src/features/settings/LanguageSwitcher.test.tsx  # ← components/LanguageSwitcher.test.tsx
importers: components/ui/{Day,Week,Month}Picker.tsx, pages/DayPage.tsx,
  features/calendar/{MonthView,WeekView,WeekAgendaView}.tsx,
  features/payments/{PaymentRow,PaymentsHeader}.tsx, features/reminders/ReminderBell.tsx,
  app/AppLayout.tsx, features/settings/InterfaceSection.tsx
```

**Structure Decision**: patterns in the root config are relative to the repo root, so globs are
`apps/web/src/<layer>/**`. Moves use `git mv` to keep history.

## Complexity Tracking

None.
