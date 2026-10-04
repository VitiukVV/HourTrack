# Feature Specification: Folder structure of app, pages and lib

**Feature Branch**: `feature/architecture-refactor`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Owner 2026-10-04 — step 2 of `docs/audit/2026-10-04-architecture-audit.md` (A8):
`app/` mixes shell, routing and hooks; `pages/` and `lib/` are flat with loose files. Group them
by role, as my-diary spec 028 did. Internal refactor, no behaviour change, no version bump, no
«Що нового».

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find where a module lives by its role (Priority: P1)

A developer looking for the error screen, a route, a page or a date helper finds it from the
folder name, without scanning a flat list.

**Why this priority**: The rest of the audit (repos, cycle removal, live queries) adds files to
`lib/` and `app/`; a role layout must exist before they land.

**Independent Test**: list `src/app`, `src/pages`, `src/lib` — no loose source files remain;
the gate passes.

**Acceptance Scenarios**:

1. **Given** `src/app`, **When** listed, **Then** it contains only `shell/`, `routing/`,
   `providers/`.
2. **Given** `src/pages`, **When** listed, **Then** it contains one folder per page section, each
   page with its test beside it.
3. **Given** `src/lib`, **When** listed, **Then** it contains only role folders (`db/`,
   `google/`, `hooks/`, `sync/`, `i18n/`, `utils/`, `ui/`).

### Edge Cases

- Path-sensitive code moves correctly: the source-scanning test using `import.meta.glob`, lazy
  `import()` of routes and locales, `vi.mock` paths, `components.json` (shadcn `utils` alias),
  coverage globs in `vitest.config.ts`.
- `src/App.tsx`, `src/main.tsx` stay at the root (composition root, see spec 002).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `src/app` MUST be split into `shell/` (AppLayout, DbInterruptedScreen,
  ErrorBoundary, ErrorScreen, RequireAuth, useStickyChromeHeight), `routing/` (router, routes,
  useScrollRestoration) and `providers/` (queryClient).
- **FR-002**: `src/pages` MUST have one folder per section: `day/`, `home/`, `login/`,
  `payments/`, `reports/`, `settings/`, `whats-new/`; tests beside their page.
- **FR-003**: `src/lib` MUST have no loose files: `i18n/` (i18n, zodI18n, calendarLocale + i18n
  tests), `utils/` (utils, date, timeOfDay, noAutofill, scroll + tests), `ui/` (colors + test);
  `db/`, `google/`, `hooks/`, `sync/` unchanged.
- **FR-004**: Every import, mock path, glob and config path (`components.json`,
  `vitest.config.ts`) MUST point at the new locations; files move with `git mv` (history kept).
- **FR-005**: No user-visible change: no version bump, no changelog, no locale change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm lint && pnpm typecheck && pnpm test` and `pnpm build` pass; test count is
  unchanged (1239 web tests).
- **SC-002**: Zero loose `.ts`/`.tsx` files directly under `src/app`, `src/pages`, `src/lib`.

## Assumptions

- Module file names stay the same; only their folder changes.
- `colors.ts` (card colour presets + contrast) goes to `lib/ui/` as UI-facing data, mirroring
  my-diary's `lib/ui/`.
- Historical docs (`docs/archive/`, closed specs) are not rewritten.
