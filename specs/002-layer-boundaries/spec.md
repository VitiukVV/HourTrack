# Feature Specification: Layer boundaries enforced by lint

**Feature Branch**: `feature/architecture-refactor`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Owner 2026-10-04 — step 1 of `docs/audit/2026-10-04-architecture-audit.md`: add layer
edges to `eslint.config.js` via `no-restricted-imports` (as `layerBoundary()` in my-diary): `lib`
does not import features/pages/app/components; features and components do not import pages/app;
pages do not import `@/lib/db/schema`; tests exempt. Fix the current A2 violations: the date
pickers import `features/calendar/calendarLocale` (move it into `lib`), `LanguageSwitcher`
imports `features/settings/useSettings` (move it into `features/settings`). Internal refactor,
no behaviour change, no version bump, no «Що нового».

The "user" of this feature is the developer (owner or agent) changing HourTrack later.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A wrong-direction import fails the lint gate (Priority: P1)

A developer adds an import that points up the layer stack (e.g. a `lib` module importing a
feature). `pnpm lint` fails with a message naming the rule, so the mistake never reaches `main`.

**Why this priority**: The audit's cycles and inversions (A1, A2) came back because nothing
checks them. Without the gate, every later refactoring step can silently regress.

**Independent Test**: Add a throwaway forbidden import in each guarded layer, run lint, see one
error per edge; remove it, lint is clean.

**Acceptance Scenarios**:

1. **Given** a file in `lib/`, **When** it imports from `features/`, `pages/`, `app/` or
   `components/` (by `@/` alias or by relative path), **Then** lint reports an error.
2. **Given** a file in `features/` or `components/`, **When** it imports from `pages/` or `app/`,
   **Then** lint reports an error.
3. **Given** a file in `components/` (including the project's own pickers under
   `components/ui/`), **When** it imports from `features/`, **Then** lint reports an error.
4. **Given** a page, **When** it imports the raw database schema module, **Then** lint reports
   an error.
5. **Given** a test file (`*.test.*`), **When** it imports across any of these edges, **Then**
   lint does not report it.

### User Story 2 - Today's code passes the new gate unchanged in behaviour (Priority: P1)

The existing violations are removed by moving two modules to the layer they belong to; the app
looks and works exactly as before.

**Why this priority**: The gate cannot be turned on while the code violates it.

**Independent Test**: lint, typecheck and the full test suite pass; the date pickers, payments
month names, reminder bell dates and the language switcher render as before.

**Acceptance Scenarios**:

1. **Given** the date-locale helper, **When** any picker, page or feature needs it, **Then** it
   imports it from `lib`, and no copy remains in `features/calendar`.
2. **Given** the language switcher, **When** the header or Settings → Interface renders it,
   **Then** it comes from `features/settings`, and its tests move with it.

### Edge Cases

- Relative imports climbing into a guarded directory (`../features/...`) are caught as well as
  `@/` aliases.
- The shadcn primitives in `components/ui/` stay excluded from lint (vendor code), but the
  project's own components there (`DayPicker`, `WeekPicker`, `MonthPicker`, `TimeInput`) are
  linted so the `components ↛ features` edge covers them.
- Imports between features stay allowed (cycles between features are step 4 of the audit).
- Type-only imports (`import type`) count as imports: a forbidden edge is forbidden for types too.
- Dynamic `import()` is not covered by the rule; today no guarded layer uses it across an edge
  (only `lib/i18n.ts` loads its own locale JSON). Accepted limitation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Lint MUST forbid `lib/**` from importing `features`, `pages`, `app`, `components`.
- **FR-002**: Lint MUST forbid `features/**` and `components/**` from importing `pages` and `app`.
- **FR-003**: Lint MUST forbid `components/**` from importing `features`.
- **FR-004**: Lint MUST forbid `pages/**` from importing the raw schema module `lib/db/schema`.
- **FR-005**: Each forbidden edge MUST report a message naming the layer rule; files matching
  `**/*.test.*` are exempt (the repo has no other test helpers under `src/`); both alias and
  relative forms are matched.
- **FR-006**: The lint ignore for `components/ui/` MUST be narrowed to the seven shadcn vendor
  files (`button`, `dialog`, `dropdown-menu`, `input`, `popover`, `select`, `switch`) so the
  project's own components there are checked.
- **FR-007**: `calendarLocale` MUST move from `features/calendar/calendarLocale.ts` to
  `lib/calendarLocale.ts`, with every importer (pickers, `DayPage`, payments, reminders,
  calendar views) updated; `LanguageSwitcher` and its test MUST move to `features/settings`.
- **FR-008**: No user-visible change: no version bump, no changelog entry, no locale change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm lint && pnpm typecheck && pnpm test` and `pnpm build` pass on the branch.
- **SC-002**: A forbidden import added on each of the four edges produces exactly one lint error
  each (verified once by hand, then removed).
- **SC-003**: Zero imports from `components/` into `features/` remain.

## Assumptions

- The edge set follows my-diary's `layerBoundary()` plus FR-003, which the audit's A2 needs and
  my-diary does not have.
- The rules start as `error`, not `warn`: there are no remaining violations after FR-007.
- `calendarLocale` lands as `lib/calendarLocale.ts` for now; step 2 (folder structure) groups
  `lib/` into role folders.
- `src/App.tsx` and `src/main.tsx` are the composition root (same layer as `app/`) and stay
  unrestricted. `packages/shared-*` sit below `lib` and cannot import `apps/web` at all, so no
  rule is needed for them.
