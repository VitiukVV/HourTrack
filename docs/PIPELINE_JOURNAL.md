# HourTrack -- Pipeline Journal

Cross-sprint context for the APEX pipeline. Each sprint records what it actually delivered, deviations from the spec, patterns introduced (reusable by downstream sprints), and follow-ups for later sprints.

Local-only mode: no GitHub PRs in this run. "PR local" denotes a feature-branch squash-merge into local `main`.

---

## S01 (PR local)

**Sprint:** Monorepo Skeleton + Web App Bootstrap
**Merged:** 2026-05-14
**Merge commit:** see `git log main --oneline` (`Merge S01: Monorepo Skeleton + Web App Bootstrap`)

### Delivered

- Root tooling: pnpm workspaces (`apps/*`, `packages/*`), Turbo 2 pipeline (`build`, `dev`, `lint`, `typecheck`, `test`, `format`, `clean`), `tsconfig.base.json` with strict TS5 / `target: ES2022` / `moduleResolution: Bundler` / path aliases for `@hourtrack/*`, ESLint 9 flat config, Prettier, Husky pre-commit + pre-push, lint-staged.
- `apps/web` (Vite 5 + React 19 + TypeScript 5 + Tailwind 4 + shadcn/ui new-york style). shadcn primitives generated: `Button`, `Input`, `Dialog`, `Select`, `Switch`, `Tabs`. React Router v7 with `/login`, `/`, `/day/:date`, `/reports`, `/settings` and placeholder pages.
- i18next + react-i18next + browser-languagedetector. Default `uk`, fallback `en`. Locales `uk/en/es` with shared key set. `LanguageSwitcher` component persists choice to `localStorage` key `hourtrack:lang`. `<html lang>` syncs with active language (S3 fix applied post-review).
- vite-plugin-pwa with `registerType: 'autoUpdate'`, manifest (`HourTrack`, theme `#0F172A`, `display: standalone`), Workbox SW, generated placeholder PNG icons (192/512/maskable) via zero-dep `scripts/generate-placeholder-icons.mjs`.
- `packages/shared-types` and `packages/shared-utils` as empty workspace shells with their own tsconfigs; placeholders carry comments referencing the sprints that will populate them (S02 / S07 / S10).
- `.github/workflows/ci.yml` runs `pnpm install` + `turbo lint typecheck test build` on Node 20 for PRs and pushes to main.
- `README.md` scaffolded with quickstart and links to docs.
- 12 tests across `apps/web` covering route mounting (5 paths), locale parity (uk/en/es), and `LanguageSwitcher` interaction. Custom `scripts/i18n-check.mjs` flat-key parity guard runs in CI.
- `pnpm install` + `pnpm turbo lint typecheck test build` GREEN.

### Deviations

- Sprint spec line item #1 says "Turbo pipeline: build, dev, lint, typecheck, test" -- shipped `format` and `clean` tasks too. Harmless extension.
- `pwa-asset-generator` recommended in spec was replaced with a zero-dep Node script (`scripts/generate-placeholder-icons.mjs`) that hand-builds tiny PNGs with `zlib`. Rationale: avoids network round-trips in CI and keeps "low priority assets are OK" promise. README at `apps/web/public/icons/README.md` documents how to regenerate.
- Code-reviewer flagged 5 warnings (W1-W5) and 6 suggestions (S1-S6). Only **S3** (`<html lang>` sync) was applied pre-merge because it is a real accessibility regression. The rest are deferred to journal followups below (none are blockers; code-reviewer verdict was APPROVE).
- Pipeline mode: local-only. No GitHub push, no PR, no Copilot review. Sub-agent paused after Stage 3D APPROVE; orchestrator manually applied S3 fix + Phase 3 merge + Phase 4 tracker/journal updates.

### Patterns introduced

These are conventions later sprints should reuse:

- **Workspace package naming:** `@hourtrack/shared-types`, `@hourtrack/shared-utils`, `@hourtrack/web`. TS path alias `@hourtrack/*` resolves to `packages/*/src`. App-local alias `@/*` resolves to `apps/web/src/*`.
- **i18n key namespace:** flat keys grouped by feature prefix (`app.*`, `nav.*`, `lang.*`, `common.*`). Parity enforced by `scripts/i18n-check.mjs`. Every new locale entry must exist in all three files.
- **`<html lang>` sync** lives in `apps/web/src/lib/i18n.ts` via `languageChanged` listener. Do not re-implement elsewhere.
- **Test setup:** `apps/web/vitest.setup.ts` polyfills pointer-capture for Radix Select/Dialog tests. New components using Radix overlays inherit this automatically.
- **Sprint commit prefix:** `<type>(s01): ...` -- pattern carries the sprint ID for traceability. Use `(s02)` etc. in your sprint.
- **Local-only merge protocol:** feature branch `feature/sXX-<short-name>` → commits → `git checkout main && git merge --no-ff` → `git branch -d`. Tracker row sets `Status: MERGED`, `PR: local`. No `git push` during pipeline.
- **Placeholder file convention:** when stubbing for a future sprint, write `// <S0X>: <brief description>` comment, never `// TODO`. This makes downstream discovery deterministic.

### Integration notes

- shadcn primitives live at `apps/web/src/components/ui/*`. Import with `@/components/ui/<name>`.
- TypeScript composite refs are wired via `tsconfig.json` (references hub, `files: []`). Each project (`tsconfig.app.json`, `tsconfig.node.json`, `packages/*/tsconfig.json`) declares its own `include`. **Caveat (W1/W2):** `vite.config.ts` is currently included in both `tsconfig.app.json` and `tsconfig.node.json` -- this is a latent dual-ownership issue that will bite S02 if more tsconfig topology lands. S02 should restrict `tsconfig.app.json` `include` to `src/**` and move tooling configs exclusively under `tsconfig.node.json`.
- Tailwind 4 uses CSS variables + Lightning CSS. `postcss.config.*` is intentionally absent. Do not add `autoprefixer` (W3 -- see follow-up).
- Router config is currently composed inline in `apps/web/src/app/router.tsx`. Tests re-construct their own `<Routes>` tree (S6 finding). Refactor to a shared route table when adding meaningful navigation tests (likely S08).

### Followups for later sprints

- **S02: tsconfig topology cleanup.** Address W1+W2 from the S01 code review. Restrict `apps/web/tsconfig.app.json` `include` to `src/**/*.{ts,tsx,json}`. Move `vite.config.ts`, `vitest.config.ts`, `vitest.setup.ts` into `tsconfig.node.json` exclusively. Set `declaration: false` in `tsconfig.base.json` and enable it explicitly only in `packages/shared-types/tsconfig.json` and `packages/shared-utils/tsconfig.json`.
- **S02: remove unused deps.** Drop `autoprefixer` from `apps/web/devDependencies` (W3 -- Tailwind 4 uses Lightning CSS internally). Decide on `workbox-window` (W4) -- either remove or wire up an `UpdatePromptToast`; defer this decision to S10 if convenient.
- **S02 or any: extend lint-staged glob.** Pattern in root `package.json` currently misses `.mjs` files (W5). Add `*.{ts,tsx,mts,cts}` for ESLint and `*.{js,jsx,mjs,cjs,json,md,yaml,yml}` for Prettier.
- **S08: extract shared route config.** App.test.tsx mirrors the production route tree manually (S6). Extract to a `routes.ts` array consumed by both `createBrowserRouter` and `createMemoryRouter` in tests.
- **S08: harden `LanguageSwitcher` type cast.** `(i18n.resolvedLanguage ?? i18n.language).split('-')[0] as SupportedLanguage` (S2) should be runtime-checked against `SUPPORTED_LANGUAGES`. Apply when adding more Select/Dialog flows in Settings.
- **S09: forward-defined locale keys.** `nav.login` and `common.loading` exist in all three locales but have no consumer yet (S4). Pick them up in `/login` (S09) and sync loading states (S10).
- **Any: simplify `App.tsx`.** Drop the dual default+named export from `apps/web/src/App.tsx` (S5). Pick one. Trivial.
