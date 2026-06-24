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

- **`@types/node`** tracks the Node major actually used in CI/Vercel (currently
  22 — see `package.json#engines`). Do NOT chase its latest tag ahead of the
  runtime; it only produces phantom type errors.
- **Transitive-only advisories** (a vuln in a dep we don't depend on directly)
  are fixed with a targeted `pnpm.overrides` entry when the direct parent
  hasn't shipped a fix yet. Revisit and remove the override once the parent
  catches up. Current overrides (root `package.json`):
  - `js-yaml@<4.2.0 → >=4.2.0` (via eslint)
  - `@babel/core@<7.29.6 → >=7.29.6` (via @vitejs/plugin-react)

## Deferred majors (as of S26, 2026-06-24)

These were identified by `pnpm -r outdated` but deliberately deferred — each
needs its own PR + the checklist above. Listed so they're tracked, not lost:

| Package                 | Current → Latest                                                                   | Why deferred                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| @hookform/resolvers     | 3.10 → 5.x                                                                         | resolver/zod-adapter API changed across two majors; EntryEditor + CardForm use custom resolvers               |
| i18next / react-i18next | 23 → 26 / 15 → 17                                                                  | init API + types shifted; lazy-locale setup (S23) + `useZodMessageTranslator` need re-validation; do together |
| sonner                  | 1.7 → 2.x                                                                          | toast API tweaks; used widely (save/delete/sync/restore)                                                      |
| tailwind-merge          | 2 → 3                                                                              | pairs with Tailwind v4; verify `cn()` output unchanged                                                        |
| typescript              | 5.6 → 6.x                                                                          | new TS major = new errors monorepo-wide + eslint-parser alignment; dedicated PR                               |
| eslint stack            | eslint 9→10, @eslint/js, eslint-plugin-react-hooks 5→7, globals, typescript-eslint | flat-config + rule changes; do as one lint-stack PR                                                           |
| @vitejs/plugin-react    | 4.7 → 6.x                                                                          | the @babel/core advisory it pulled is already neutralised via override; bump on its own when convenient       |
| @types/node             | 22 → 26                                                                            | pinned to the CI/Vercel Node line on purpose (see Special cases)                                              |
| lint-staged             | 15 → 17                                                                            | config-shape changes across majors; low value                                                                 |
