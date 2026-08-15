# Dependency Policy

How this repo keeps dependencies current and advisory-free without churn.
Established in S26 (2026-06-24).

## Audit gate

- CI runs **`pnpm audit --prod --audit-level=high`** as a **blocking** step. A
  high/critical advisory in a **runtime** dependency fails the build.
- CI also runs a **full-tree `pnpm audit`** (incl. devDependencies) as an
  **informational** step (`|| true`). It never blocks — dev/build-tool
  advisories don't ship to users — but keeps the count visible in the logs.
- Rationale: severity ≠ exposure. A "critical" in `vitest`/`vite`/`happy-dom`
  only touches the dev/CI box; a "moderate" in a runtime dep ships to every
  user. The gate is scoped to where exposure is real; the rest is tracked, not
  alarmed.

## Update cadence

- **Patch + minor:** batched into one weekly Dependabot PR
  (`.github/dependabot.yml`, group `patch-and-minor`). Auto-mergeable once CI is
  green — they're within-major and the suite + e2e cover regressions.
- **Major:** one PR per package. Each gets the breaking-change checklist below.
  Never batch majors — a red CI on a grouped major PR hides which bump broke.
- **GitHub Actions:** weekly, separate group.

## Major-upgrade checklist

Before merging any major bump:

1. Read the package's migration notes / changelog.
2. `pnpm -F <pkg-consumer> typecheck && lint && test` green.
3. `pnpm -F web e2e` green (or the relevant subset).
4. Smoke-test the surfaces that consume it.
5. For build-chain majors (vite/vitest/plugin-react), re-run `pnpm audit` and
   re-measure the index bundle against the budget in `docs/PERF_NOTES.md`.

## Special cases

- **`@dnd-kit/core` + `@dnd-kit/utilities` are EXACT-pinned** (no caret:
  `6.3.1` / `3.2.2` in `apps/web/package.json`), unlike the caret ranges every
  other runtime dep uses. This is **deliberate** (S31 note): drag-and-drop
  reschedule (S25) is timing- and pointer-sensitive, and past `@dnd-kit`
  patch/minor bumps have shifted touch-press-hold + sensor behaviour on mobile.
  Pinning keeps DnD regressions out of the auto-merged weekly patch/minor
  Dependabot flow; `@dnd-kit` upgrades are taken deliberately, one PR at a time,
  with the drag surfaces smoke-tested (month/week reschedule, touch press-hold,
  keyboard a11y announcements) before merge.
- **`@types/node`** tracks the Node major actually used in CI/Vercel (currently
  22 — see `package.json#engines`). Do NOT chase its latest tag ahead of the
  runtime; it only produces phantom type errors. Dependabot re-opens a
  `22 → 26` PR anyway; **close it, don't merge it** — the correct trigger for
  that bump is moving `engines.node` and the CI `node-version`, not the
  registry's latest tag.
- **A clean `tsc -b` needs `--force` when validating a dependency bump.** The
  incremental build reuses `tsconfig.tsbuildinfo` and reports zero errors for a
  changed `node_modules` — a zod 3 → 4 bump typechecked "green" locally and only
  showed its 9 breaking errors under `tsc -b --force --noEmit`. CI is unaffected
  (fresh checkout, no buildinfo), but a local pre-flight can silently lie.
- **Transitive-only advisories** (a vuln in a dep we don't depend on directly)
  are fixed with a targeted `pnpm.overrides` entry when the direct parent
  hasn't shipped a fix yet. Revisit and remove the override once the parent
  catches up. Current overrides (root `package.json`):
  - `js-yaml@<4.2.0 → >=4.2.0` (via eslint)
  - `@babel/core@<7.29.6 → >=7.29.6` (via @vitejs/plugin-react)

## Deferred majors

Identified by `pnpm -r outdated` and deliberately deferred — each needs its own
PR + the checklist above. Listed so they're tracked, not lost. Cleared rows move
to "Taken" below.

| Package                 | Current → Latest                                                          | Why deferred                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| @hookform/resolvers     | 3.10 → 5.x                                                                | resolver/zod-adapter API changed across two majors; EntryEditor + CardForm use custom resolvers                                  |
| i18next / react-i18next | 23 → 26 / 15 → 17                                                         | init API + types shifted; lazy-locale setup (S23) + `useZodMessageTranslator` need re-validation; do together                    |
| **zod**                 | **3.25 → 4.x**                                                            | **real code migration — see the sized-up entry below**                                                                           |
| tailwind-merge          | 2 → 3                                                                     | pairs with Tailwind v4; verify `cn()` output unchanged                                                                           |
| typescript              | 5.6 → 6.x                                                                 | new TS major = new errors monorepo-wide + eslint-parser alignment; dedicated PR                                                  |
| eslint stack            | eslint 9→10, @eslint/js, eslint-plugin-react-hooks 5→7, typescript-eslint | flat-config + rule changes; do as one lint-stack PR (`globals` already taken separately — it is a data package, no rule surface) |
| @vitejs/plugin-react    | 4.7 → 6.x                                                                 | the @babel/core advisory it pulled is already neutralised via override; bump on its own when convenient                          |
| @types/node             | 22 → 26                                                                   | pinned to the CI/Vercel Node line on purpose (see Special cases) — Dependabot's PR gets **closed**, not merged                   |

### zod 3 → 4 — sized up 2026-08-15, not taken

Bumped on a scratch branch and reverted. `tsc -b --force --noEmit` reports **9
errors across 5 schema files**, all the v4 error-customisation rename:
`required_error` / `invalid_type_error` / `errorMap` collapse into a single
`error` param.

- `features/cards/cardSchema.ts`, `features/entries/entrySchema.ts`,
  `features/payments/paymentSchema.ts`, `features/reminders/reminderSchema.ts`,
  `features/backup/validateSnapshot.ts` (also uses `.passthrough()`, superseded
  by `z.looseObject()` in v4).
- The messages are **i18n keys**, not prose — `useZodMessageTranslator` maps
  `issue.message` to a translation key, so a mechanical rename is not enough:
  every migrated message has to keep resolving to the same key or the form
  errors go blank. `cardSchema.test.ts` / `entrySchema.test.ts` assert those
  keys by string and are the regression net.
- `validateSnapshot` is the Drive-restore gate. Its `safeParse` result feeds
  `SnapshotValidationError` codes and the `isTimeFieldIssue` heuristic reads
  `parsed.error.issues` — v4 keeps `.issues` but changes some issue `code`
  values, so the restore-rejection paths need re-testing, not just re-compiling.

Own sprint, not a dependency sweep.

## Taken

| Package                 | Bump      | When       | Notes                                                                                                                                                                       |
| ----------------------- | --------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sonner                  | 1.7 → 2.x | 2026-08-15 | No source change. `<Toaster richColors closeButton position theme>` and every `toast.*` call site compile and behave identically; e2e covers the undo/success/error toasts. |
| lint-staged             | 15 → 17   | 2026-08-15 | Root `lint-staged` config shape (glob → command array) is unchanged in 17; exercised by the pre-commit hook on this PR.                                                     |
| globals                 | 15 → 17   | 2026-08-15 | Data-only package. `eslint . --max-warnings=0` green across all 3 workspaces.                                                                                               |
| actions/setup-node      | v6 → v7   | 2026-08-15 | ESM migration + cache outputs. The one removal (dummy `NODE_AUTH_TOKEN`) is npm-publish only.                                                                               |
| actions/upload-artifact | v4 → v7   | 2026-08-15 | v6 moved to Node 24 and needs runner ≥ 2.327.1 — satisfied by `ubuntu-latest`. Used only for the Playwright report artifact.                                                |
