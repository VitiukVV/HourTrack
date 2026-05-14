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

---

## S02 (PR local)

**Sprint:** Shared Types + Shared Utils + Dexie DB Layer
**Merged:** 2026-05-14
**Merge commit:** `4c23de9` (`Merge S02: Shared Types + Utils + Dexie DB Layer`)

### Delivered

- `@hourtrack/shared-types` populated with the four canonical entities from PROJECT_PLAN.md §7.1: `Card` (+ `RateType`), `Entry` (+ `SyncStatus`), `Settings` (+ `Language` / `Theme` / `CalendarView`), `DriveSnapshot` (schemaVersion 1). Pure interfaces, no runtime code.
- `@hourtrack/shared-utils` populated with the spec helpers:
  - `formatDuration(min) -> "{H}H {M}M"` and `parseDuration(h, m) -> minutes` (PROJECT_PLAN.md §7.3 verbatim — no zero-padding, uppercase H/M markers).
  - `earningsForEntry(entry, card, allCardEntries)` (PROJECT_PLAN.md §7.2 verbatim — three branches: custom-payment-wins, hourly-multiply, fixed-proportional-split with `remainingPool = max(0, fixedTotal − sum(customPayments))`).
  - `date-range.ts` wrappers over date-fns with `weekStartsOn: 1` baked in: `startOfWeekMonday`, `endOfWeekSunday`, `startOfMonth`, `endOfMonth`, `eachDayInRange`, `formatLocalDate`.
- `apps/web/src/lib/colors.ts` — 12-color `CARD_COLORS` palette (readonly tuple via `as const`) + `GOOGLE_CALENDAR_COLOR_MAP` (hex → colorId "1".."11", slate falls back to "8") + `isValidCardColor(hex)` runtime guard per PROJECT_PLAN.md §7.5.
- `apps/web/src/lib/date.ts` — `DATE_FORMAT = 'dd.MM.yyyy'`, `WEEK_STARTS_ON = 1`, `formatDate()` wrapper. UI-side `DD.MM.YYYY` formatter only; storage-side `YYYY-MM-DD` formatting lives in shared-utils' `formatLocalDate`.
- `apps/web/src/lib/db/` — Dexie v1 schema (`cards`, `entries`, `settings`, `syncQueue`), pure-function CRUD layer (`createCard`, `updateCard`, `archiveCard`, `restoreCard`, `getAllCards`, `getCardById`, `createEntry`, `updateEntry`, `deleteEntry`, `getEntriesByDate`, `getEntriesByDateRange`, `getEntriesByCardId`, `getSettings`, `updateSettings`), and an idempotent `initDB(db)` that seeds the single `Settings` row on first boot. `main.tsx` fire-and-forget invokes `initDB(db)`.
- S01 followups W1-W5 all applied in-sprint:
  - **W1+W2:** `declaration: false` in `tsconfig.base.json`; explicit `declaration: true` in `packages/shared-types/tsconfig.json`, `packages/shared-utils/tsconfig.json`, `apps/web/tsconfig.{app,node}.json` (composite required it). `apps/web/tsconfig.app.json` `include` reduced to `src/**`; `vitest.setup.ts` moved exclusively into `tsconfig.node.json`. A new ambient `apps/web/src/vitest-globals.d.ts` (triple-slash-references `@testing-library/jest-dom`) re-surfaces matcher types to the src-side test files.
  - **W3:** removed `autoprefixer` from `apps/web/devDependencies`.
  - **W4:** removed `workbox-window` from `apps/web/devDependencies`. `vite-plugin-pwa` handles SW registration via `injectRegister: 'auto'`.
  - **W5:** root `lint-staged` glob extended — `*.{ts,tsx,mts,cts}` for ESLint, `*.{js,jsx,mjs,cjs,json,md,yaml,yml}` for Prettier.
- 41 tests across the workspace, all green: 33 in `shared-utils` (duration 10, earnings 11, date-range 12) and 41 total in `apps/web` (colors 7, date 5, db 17, plus pre-existing App 9 + i18n 3). `pnpm turbo lint typecheck test build` is clean (12/12 tasks).

### Deviations

- **Workspace path-alias removal in tsconfig.** The S01 setup declared `@hourtrack/shared-types` and `@hourtrack/shared-utils` aliases pointing at source `index.ts` in both `tsconfig.base.json` and `apps/web/tsconfig.app.json`. Once `shared-types` started exporting concrete types (not just `export {}`), TypeScript began pulling files outside each project's `rootDir` via the alias, triggering TS6059 and TS6307. Fix: dropped the alias entries from both files; resolution now goes through pnpm's `node_modules/@hourtrack/*` symlinks which expose the package's `main`/`types` fields (both point at `src/index.ts`, so the runtime/build surface is unchanged). The Vite `resolve.alias` config in `apps/web/vite.config.ts` is unchanged — it still resolves the same names to the same source files. App-local `@/*` alias remains in `tsconfig.app.json`. This is a structural cleanup beyond what the sprint spec strictly required but was forced by the type-concrete shared-types landing.
- **`colors.ts` location.** DEP_CONTEXT requested `packages/shared-utils/src/colors.ts`, but the sprint-spec task table (#16) and PROJECT_PLAN.md §6 monorepo structure both place it at `apps/web/src/lib/colors.ts`. Followed the sprint spec (authoritative under APEX). If S07 (Reports) or S12 (Calendar sync) needs the palette outside `apps/web`, we can later promote it to `shared-utils` with a moved-symbol followup commit — for now both consumers live in `apps/web`.
- **`syncQueue` index miss-then-fixed.** Initial schema string was `'++id, entityType, entityId, createdAt'`; sprint spec lists `op` as an index too. Caught in Stage 3D code review and fixed in commit `05c2576` before merge. Final schema: `'++id, op, entityType, entityId, createdAt'`.
- **Test layer placement.** Sprint spec task #14 says "Dexie seed/init" lives in `apps/web/src/lib/db/index.ts`. I placed the actual `initDB` implementation in `queries.ts` and re-exported through `index.ts` to keep `index.ts` a pure barrel (matches the shared-types / shared-utils pattern). Externally identical.

### Patterns introduced

These are conventions later sprints should reuse:

- **No source-path aliases for workspace packages.** Workspace TypeScript imports resolve via pnpm symlinks under `node_modules/@hourtrack/*` (which expose the package's `main`/`types` fields). Do NOT re-add `@hourtrack/shared-types` etc. paths in any `tsconfig.json` — they break `rootDir` for composite projects. App-local `@/*` aliases ARE fine.
- **DB query layer is pure-function + db-arg-injected.** Every helper takes the `HourTrackDB` instance as its first arg (`createCard(db, input)`, not `card.create(input)`). Tests build their own DB instance per case (`new HourTrackDB(uniqueName)`); runtime uses the singleton `db` exported from `@/lib/db`. Downstream features MUST follow this shape — no `useCards` hook that secretly imports the singleton; the hook wraps the pure function and takes the singleton explicitly.
- **`updatedAt` stamping is the query-layer's job, not the caller's.** Every write helper (`createCard`, `updateCard`, `archiveCard`, `createEntry`, `updateEntry`, `updateSettings`) stamps `updatedAt = new Date().toISOString()`. Callers MUST NOT pass `updatedAt` in patches — even if they try, the helper overwrites it. This is the invariant S10's Drive LWW merge relies on.
- **`Entry.date` is local YYYY-MM-DD, not ISO datetime, not UTC.** Use `formatLocalDate(date)` from `@hourtrack/shared-utils` to produce it. NEVER `toISOString().slice(0, 10)` — that silently shifts dates near midnight across timezones.
- **`formatDuration` / `parseDuration` are the ONLY sanctioned conversion path between minutes and `{H}H {M}M`.** UI MUST go through them; no inline duration strings. Same applies to `formatDate` for `DD.MM.YYYY` and `formatLocalDate` for `YYYY-MM-DD`.
- **`earningsForEntry` returns a raw float; rounding is a presentation-layer concern.** Tables / charts / Calendar event titles should call `.toFixed(2)` at the render boundary. Do not round inside the calculator — per-entry rounding errors compound across reports.
- **Dexie store row shape for single-row tables: `Entity & { key: 'current' }`.** Cf. `SettingsRow`. Strip the `key` discriminator in the `getSettings` accessor before returning the public `Settings` shape.
- **`fake-indexeddb/auto` import inside `db.test.ts`** is the recipe for DB integration tests in this project. Each test creates a uniquely-named DB and `await db.delete()`s in `afterEach` for isolation.
- **Ambient type extension for jest-dom matchers** lives at `apps/web/src/vitest-globals.d.ts`. If you add another test-runner matcher package, extend this file rather than re-including a setup file in `tsconfig.app.json`.

### Integration notes

- Dexie schema `version(1).stores(...)` is locked: `cards: 'id, name, isArchived, updatedAt'`, `entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt'`, `settings: 'key'`, `syncQueue: '++id, op, entityType, entityId, createdAt'`. **ANY change to a table's indexed fields requires bumping `version(2)` and shipping a `.upgrade()` migration.** Do not silently mutate the v1 string.
- The `[cardId+date]` compound index is the fast path for "all entries for card X on date Y". Use it via `db.entries.where('[cardId+date]').equals([cardId, date])`. The current `getEntriesByDate` and `getEntriesByCardId` helpers do NOT use the compound — add a new `getEntriesByCardAndDate(db, cardId, date)` helper in S05/S06 when the multi-session-per-day-per-card flow lands.
- `Settings.hourtrackCalendarId` is `null` until S12 wires the Calendar create-on-first-sync flow. Do not assume it is populated.
- `Entry.syncStatus` defaults to `'pending'` on every create (caller's responsibility — `createEntry` does not auto-set it; the input shape requires it). S10's SyncManager will flip it to `'synced'` or `'error'`.
- New package surface for downstream sprints:
  - From `@hourtrack/shared-types`: `Card`, `RateType`, `Entry`, `SyncStatus`, `Settings`, `Language`, `Theme`, `CalendarView`, `DriveSnapshot`.
  - From `@hourtrack/shared-utils`: `formatDuration`, `parseDuration`, `earningsForEntry`, `startOfWeekMonday`, `endOfWeekSunday`, `startOfMonth`, `endOfMonth`, `eachDayInRange`, `formatLocalDate`.
  - From `@/lib/db`: `db`, `HourTrackDB`, `initDB`, plus all CRUD/query helpers.
  - From `@/lib/colors`: `CARD_COLORS`, `CardColor`, `GOOGLE_CALENDAR_COLOR_MAP`, `isValidCardColor`.
  - From `@/lib/date`: `DATE_FORMAT`, `WEEK_STARTS_ON`, `formatDate`.
- `shared-utils` now has a real Vitest configuration (`vitest run --passWithNoTests`). Default Node env, no setup file. If a future helper needs DOM (it shouldn't — utilities stay framework-agnostic), spin up an `apps/`-side package instead.

### Followups for later sprints

- **S03: validate `Card.color` against the palette.** `createCard` / `updateCard` currently accept ANY string as `color`. The UI form should refuse non-palette values (use `isValidCardColor` from `@/lib/colors`), but a defensive runtime check in `createCard` would prevent Drive-snapshot restore (S11) from re-introducing stale hexes if the palette ever shrinks. Trivial — gate with `isValidCardColor(input.color)` and throw on mismatch.
- **S03: enforce rate-type field invariants.** When `rateType === 'hourly'`, `hourlyRate` must be non-null and `fixedTotal` should be null (and vice versa). The data model allows the wrong shape today; tighten in the Card form and add a small `assertCardShape(card)` helper consumed by createCard/updateCard.
- **S05/S06: add `getEntriesByCardAndDate(db, cardId, date)`** that uses the `[cardId+date]` compound index — required by the active-card "click same day twice removes entry" flow and the day-page "add entry to this card on this day" flow.
- **S07: decide if `colors.ts` should move into `@hourtrack/shared-utils`.** Currently lives in `apps/web/src/lib/colors.ts`. Reports' chart-color mapping and S12's `colorId` mapping both consume it from `apps/web` today, so it's not yet a problem. If a future shared package needs it (unlikely), promote then.
- **S07/S08: presentation-layer EUR rounding.** Standardize on `.toFixed(2)` at the render site for tables, charts, and CSV. Document this in a shared `formatEur(amount)` helper if more than two callers emerge.
- **S10: SyncQueue write helpers.** S02 ships the store but no `enqueueSyncOp(op, type, id)` helper. Add when SyncManager lands.
- **S11: restore-from-snapshot path must accept the v1 `DriveSnapshot` shape verbatim.** If we ever bump `schemaVersion`, add a migration step before re-hydrating Dexie tables; do NOT silently coerce.
- **S13: build chunk size.** Vite already warns "551 kB chunk". When S13 lazy-loads Reports/Calendar routes, this should drop significantly. If not, add `rollupOptions.output.manualChunks` for `dexie` and `date-fns`.
- **Any: `getAllCards` index strategy.** The default `includeArchived=false` filter is in-memory because Dexie booleans index inconsistently across browsers. If profiling ever shows it's hot (unlikely with <100 cards), revisit with an explicit `where('isArchived').equals(0)` query.

---

## S03 (PR local)

**Sprint:** Cards CRUD + CardsHeader UI
**Merged:** 2026-05-14
**Merge commit:** `014a7a9` (`Merge S03: Cards CRUD + CardsHeader UI`)

### Delivered

- `apps/web/src/features/cards/` — full feature folder: `CardsHeader.tsx` (sticky header with `[+]` button + carousel of active card chips), `CardChip.tsx` (color-marked chip with toggle-on-click + onContextMenu for edit/archive), `CardForm.tsx` (modal form with name, 12-color picker, dual H/M duration input, rateType toggle with conditional hourlyRate or fixedTotal, optional defaultNote), `CardModal.tsx` (create/edit wrapper), `ColorPicker.tsx` (12-swatch grid), `ArchivedCardsList.tsx` (Settings-page section, surfaces in S08), `cardSchema.ts` (zod discriminated-union schema), `useActiveCardStore.ts` (Zustand store with `partialize` + sessionStorage persistence), `useCards.ts` (TanStack Query hooks).
- DB hardening in `apps/web/src/lib/db/queries.ts`: `assertCardShape(card)` runtime guard enforces `isValidCardColor(color)` and rate-type invariants (`hourly` ↔ `hourlyRate` non-null + `fixedTotal === null`, and vice versa). Wired into `createCard` (always) and `updateCard` (only when patch touches color | rateType | hourlyRate | fixedTotal — keeps archive/restore reachable for cleanup of legacy/Drive-restored malformed records, per the post-review blocker fix).
- `getArchivedCards(db)` helper added for the Settings-page archive list.
- TanStack Query QueryClient configured at `apps/web/src/app/queryClient.ts` and wired in `main.tsx` / `App.tsx`.
- AppLayout updated to mount `<CardsHeader />` in the header slot from S01.
- 26 new i18n keys per locale under `cards.*` (`cards.add`, `cards.edit`, `cards.archive`, `cards.restore`, `cards.name`, `cards.color`, `cards.defaultHours`, `cards.defaultMinutes`, `cards.rateType`, `cards.rateHourly`, `cards.rateFixed`, `cards.hourlyRate`, `cards.fixedTotal`, `cards.defaultNote`, `cards.validation.*`). Parity check in CI passes.
- 60 new tests (98 total, all green) across 7 new test files: `useCards.test.tsx`, `useActiveCardStore.test.ts`, `CardsHeader.test.tsx`, `CardForm.test.tsx`, `ColorPicker.test.tsx`, `cardSchema.test.ts`, `queries.assertCardShape.test.ts`.
- New deps added in S03: `@tanstack/react-query@5`, `react-hook-form@7`, `zod@4`, `@hookform/resolvers@5`, `zustand@5`, `sonner` (installed but not yet wired — see Followups).

### Deviations

- **Hook naming drift.** Sprint spec table named hooks `useCardsList(includeArchived)`, `useCard(id)`, `useCreateCard`, etc. Implementation shipped `useCardsQuery`, `useArchivedCardsQuery`, `useCardQuery`, `useCreateCardMutation`, `useUpdateCardMutation`, `useArchiveCardMutation`, `useRestoreCardMutation` (TanStack Query conventional naming). Documented here so S05/S06/S07 know what to import. **Future sprints: import the `*Mutation` / `*Query` names; do NOT add a `useCardsList` alias.**
- **Code-reviewer flagged 1 blocker + 6 warnings + 5 suggestions.** The blocker (`updateCard` assertCardShape blocked archive on malformed records) was fixed pre-merge via the patch-key scoping shown above. Mobile touch long-press, sonner-toast wiring, context-menu collision detection, and orphan `cards.confirmDelete` keys are deferred to S05/S08 followups.
- **`sonner` shipped but not wired in this sprint.** Toast surface deferred until S08 brings global notification mounting. Save-failure error path currently logs to console only.
- **Mobile touch long-press NOT implemented.** Desktop right-click (`onContextMenu`) is wired but `useLongPress(500)` hook for touch is missing. Per PROJECT_PLAN.md §1 the PWA is mobile-first — this is a real gap. Flagged hard as a S05 followup.
- **Sub-agent paused at Stage 3D REQUEST_CHANGES.** Orchestrator applied the blocker fix on the feature branch, ran quality gates (all green), merged, and completed Phase 4 manually.

### Patterns introduced

- **TanStack Query key convention:** `['cards']` for active, `['cards', 'archived']` for archived, `['cards', id]` for individual. All mutations invalidate `['cards']` (and `['cards', 'archived']` for archive/restore).
- **Zustand `partialize` for sessionStorage persistence.** Pattern: `persist((set, get) => ({ ... }), { name: 'hourtrack:active-card', storage: createJSONStorage(() => sessionStorage), partialize: (state) => ({ activeCardId: state.activeCardId }) })`. Only the data field is serialized; action functions are excluded. Reuse for any future client-state slice that needs short-lived persistence.
- **Zod discriminated union for rate-type forms.** `CardInputSchema = z.discriminatedUnion('rateType', [ hourlyBranch, fixedBranch ])`. The branches explicitly set the OTHER rate field to `z.null()`. UI form uses `useForm({ resolver: zodResolver(CardInputSchema) })` and switches rendered fields by `watch('rateType')`. Reuse for any future "either A or B" form.
- **`assertCardShape` scoped to invariant-touching patches.** When implementing similar `assertEntryShape` (S05+) or `assertSettingsShape`, follow the same pattern: always validate on `create*`; on `update*`, only validate if the patch touches invariant-bearing fields.
- **Feature folder layout:** `apps/web/src/features/<feature>/` with `Component.tsx` + `Component.test.tsx` + `useFeature.ts` (hooks) + `featureSchema.ts` (zod) + `useFeatureStore.ts` (zustand). Tests next to source. Follow for S04+.
- **Sprint commit prefix:** `<type>(s03): ...` — continue with `(s04)`, `(s05)`, etc.

### Integration notes

- New public surface from `apps/web/src/features/cards/`:
  - Hooks: `useCardsQuery`, `useArchivedCardsQuery`, `useCardQuery`, `useCreateCardMutation`, `useUpdateCardMutation`, `useArchiveCardMutation`, `useRestoreCardMutation`, `useActiveCardStore`.
  - Components: `CardsHeader`, `CardChip`, `CardForm`, `CardModal`, `ColorPicker`, `ArchivedCardsList`.
  - Schemas: `CardInputSchema` (from `cardSchema.ts`).
- `useActiveCardStore.toggleActive(cardId)` is the canonical API for "click chip to activate". Returns void; reads `activeCardId` to flip toggle vs set. Use this in S05 day-click logic.
- `<Toaster />` from `sonner` is NOT yet mounted globally. S08 adds it.
- `queries.ts:assertCardShape` is module-private. If S05/S06 need similar runtime gates, write `assertEntryShape` in the same file, same shape.

### Followups for later sprints

- **S05 (mandatory): implement `useLongPress(500)` hook for touch.** Mobile users currently have no path to edit/archive cards. Add `apps/web/src/hooks/useLongPress.ts` (~20 lines, pointer-events-based timer) and wire into `CardChip.tsx`.
- **S05/S06: `getEntriesByCardAndDate(db, cardId, date)`** that uses the `[cardId+date]` compound Dexie index — required for active-card "click same day twice removes entry" flow (carried from S02 followup).
- **S05: drop or rename orphan `cards.confirmDelete` key.** Either consume it in the same sprint that adds permanent-delete UX, or remove it from all three locales until then.
- **S08 (mandatory): wire `sonner` toaster.** Mount `<Toaster />` at AppRouter root. Update `CardModal` save catch block to `toast.error(t('cards.saveFailed'))`.
- **S08: extract shared route config** (carried from S01 followup).
- **S08: harden `LanguageSwitcher` type cast** (carried from S01 followup S2).
- **S08: migrate bespoke context menu in CardsHeader to Radix `@radix-ui/react-context-menu`** — fixes viewport-edge collision + keyboard nav for a11y.
- **S08: i18n the `ColorPicker` aria-label.** Replace hardcoded `"Card color"` with `t('cards.color')`.
- **S08: simplify form defaults in `CardForm`.** When toggling rateType, fields currently default to `20` (hourly) or `1000` (fixed). Should default to empty/null.
- **S09: forward-defined locale keys** (carried from S01 followup).
- **S10: SyncQueue write helpers** (carried from S02 followup).
- **S11: restore-from-snapshot path must validate** every restored card through `assertCardShape` (or skip + log + flag). With scoped-shape-assertion, malformed cards can land in Dexie via restore.
- **Any: simplify `App.tsx`** (carried from S01 followup).

---

## S04 (PR local)

**Sprint:** Calendar Month + Week Views
**Merged:** 2026-05-14
**Merge commit:** `1f872d7` (`Merge S04: Calendar Month + Week Views`)

### Delivered

- `apps/web/src/features/calendar/` — `CalendarHeader` (view toggle + prev/next + Today + month/week label), `MonthView` (7×5-6 grid Mon→Sun with `DayCell` + `EntryChip`), `WeekView` (7 cols full lists), `calendarStore` (Zustand: `mode` + `anchorDate` + actions + sessionStorage persist with `partialize`), `useEntriesInRange` (TanStack Query, computes range from mode+anchor, returns `{ start, end, entries, entriesByDate, cardsById }`), `useDefaultViewSync` (one-shot Settings.defaultView → store on tab open), `calendarLocale` (date-fns CLDR for month/weekday names — no bespoke i18n keys for those).
- `pages/Home.tsx` wired to render `<CalendarHeader />` + `<MonthView>`/`<WeekView>` per mode.
- 33 new tests (135 total green): `calendarStore`, `CalendarHeader`, `MonthView` (35/42 grid logic, Mon start, today modifier, +N more overflow, note marker, footer totals), `WeekView`, `useEntriesInRange`.
- All anchor parsing uses `parseISO(YYYY-MM-DD)` after post-review W4 fix; `CALENDAR_VIEW_STORAGE_KEY` exported and reused (W3 fix).

### Deviations

- Executor paused at Stage 3D APPROVE with 4 🟡 warnings + 4 💭 suggestions; orchestrator applied W3 (DRY storage key) and W4 (timezone-safe `parseISO`) before merge. W1 (nested interactive elements) and W2 (O(N²) per-card filter) deferred to S05 followups (S05 rebuilds the day-click surface anyway).
- Month/weekday names use date-fns CLDR via `calendarLocale.ts` instead of hand-maintained i18n keys. Saves ~36 keys × 3 locales, gets correct translations for free.
- Active-card click behavior in calendar is a no-op handler in S04 (the actual create-on-click flow lands in S05).

### Patterns introduced

- **TanStack Query buckets in hook output.** `useEntriesInRange` returns precomputed `Map<date, Entry[]>` and `Map<id, Card>` so consumer components do O(1) lookups instead of per-render filters. Reuse for any list-of-related-entities feature.
- **`parseISO` is the canonical YYYY-MM-DD → Date conversion.** `new Date('2026-05-14')` is timezone-unsafe; `parseISO` treats as local midnight. Use it for every anchor-string → Date conversion in S05+.
- **CLDR via date-fns locale objects** for weekday/month display. Pattern: `format(date, 'EEE', { locale: dateFnsLocaleFor(i18nLang) })`. No bespoke locale tables.

### Integration notes

- Calendar surface state: `useCalendarView` exposes `mode`, `anchorDate`, `setMode`, `setAnchor`, `prev`, `next`, `goToday`. S05 will use `useCalendarView` + `useActiveCardStore` together.
- Entry range query key: `['entries', 'range', start, end]`. Invalidate on entry CRUD.
- `useEntriesInRange` returns `cardsById` map keyed by Card.id; `entriesByCard` was suggested in review for the O(N²) fix — apply when S05 surfaces real performance pressure.
- All DayCell click handlers: active-card-mode is a no-op (S05's job); without active card, navigate to `/day/:date`.

### Followups for later sprints

- **S05: implement W1 fix (nested interactive elements in DayCell).** Drop `role="button"` from the cell wrapper and use a focusable child element for click; S05 rebuilds this surface for create/delete anyway.
- **S05: implement W2 fix (O(N²) per-card filter in DayCell + WeekView).** Extend `useEntriesInRange` to return `entriesByCard: Map<cardId, Entry[]>`; consumers do O(1) lookups.
- **S05: useLongPress(500) hook for touch** (carried from S03 — mandatory).
- **S05: getEntriesByCardAndDate compound-index helper** (carried from S02/S03).
- **S08: useDefaultViewSync hydration race.** Could overwrite persisted choice if executed before zustand-persist completes hydration; current behavior is safe in practice because sessionStorage hydration is synchronous in zustand v5, but guard with `persist.onFinishHydration` if any flakiness emerges.
- **S08: add useDefaultViewSync.test.tsx** — currently no test file; cover 3 paths (empty session + settings='week', has key + ignore, single-run).

---

## S05 (PR local)

**Sprint:** Active-Card Day-Click Create/Delete + No-Active-Card Modal
**Merged:** 2026-05-14
**Merge commit:** `db45c4e`

### Delivered

- `apps/web/src/features/entries/`: `useEntries.ts` (TanStack Query mutations `useCreateEntryMutation` + `useDeleteEntryMutation` + `useEntriesByDateQuery`), `dayClick.ts` (pure resolver returning `{kind:'create'|'delete'|'open-picker'}` discriminated union), `DayPickerModal.tsx` (no-active-card modal with card list + inline create-card path), `ConfirmDialog.tsx` (generic confirm; sprint spec asked for `components/` but landed in `features/entries/` — S06 followup to relocate).
- `apps/web/src/hooks/useLongPress.ts` — touch-only 500ms long-press hook, callback receives the actual target element (post-review blocker fix). Wired into `CardChip` for mobile context menu.
- `apps/web/src/lib/db/queries.ts` — added `getEntriesByCardAndDate(db, cardId, date)` using `[cardId+date]` compound index (S02 followup).
- `useEntriesInRange.ts` extended to return `entriesByCard: Map<cardId, Entry[]>` (S04 W2 fix). Single-pass build.
- `DayCell.tsx` — dropped `role="button"` from wrapper; uses plain `<div>` with click + keyboard handlers, avoiding nested-interactive-element a11y violation (S04 W1 fix).
- `MonthView.tsx` + `WeekView.tsx` — wire dayClick flow + mount DayPickerModal + ConfirmDialog. Pending delete state held locally.
- Removed orphan `cards.confirmDelete` from uk/en/es; added `entries.dayPicker.*` + `entries.confirmDelete.*` keys (all locales pass parity).
- 23 new tests (158 total green): `useLongPress`, `dayClick`, `useEntries`, `DayPickerModal`, `MonthView` extension, `getEntriesByCardAndDate` query, `useEntriesInRange` `entriesByCard` shape.

### Deviations

- Executor paused at Stage 3D REQUEST_CHANGES with 1 🔴 (useLongPress target). Orchestrator applied blocker fix + merged.
- `ConfirmDialog` lives in `features/entries/` not `components/` per sprint spec. Tracked as S06/S08 followup (relocate for shared use).
- Toast confirmations on create/delete deferred to S08 (sonner Toaster not yet mounted globally — see S03 followup).

### Patterns introduced

- **Pure-function dayClick resolver** returns a discriminated union the view consumes via exhaustive switch. Reuse for other UI decision points (S06 entry-edit resolution, S11 conflict resolution).
- **`useLongPress` callback receives target.** Capture `e.currentTarget` at pointerdown into a stable closure; pass to callback when timer fires. Don't read `document.activeElement` at fire-time — it's the wrong reference.
- **Compound-index Dexie query.** `db.entries.where('[cardId+date]').equals([cardId, date])` is the fast path. Use for any future `[A+B]` lookups.

### Integration notes

- Entry mutations invalidate `['entries']` prefix. For S07 Reports with many simultaneous range/by-date queries, this may need narrowing — flagged for S07.
- DayPickerModal can create a new card inline. The CardForm modal is mounted within the picker; on save, the new card is auto-applied as the entry's card. S06 may reuse the same modal-within-modal pattern for entry edit.
- `useLongPress` is generic; signature is `(target: HTMLElement) => void`. Reuse for any other touch-gesture surface (S07 charts? probably not).

### Followups for later sprints

- **S06: relocate `ConfirmDialog` to `apps/web/src/components/`** for S08 archive/restore reuse.
- **S06: extract `useDayClickFlow` hook** to dedupe MonthView/WeekView wiring (~50 lines × 2 today).
- **S06: `useMemo(() => new Date(), [])`** for `today` in MonthView/WeekView so it's stable per mount.
- **S06: wrap MonthView "create entry on click" test in `act()`** to silence the React act warning.
- **S07: narrow `useEntries` mutation invalidation** to `['entries', 'range']` + `['entries', 'by-date', date]` once Reports mounts multiple queries.
- **S08: drop unused `cards.noCards` empty-state copy in DayPickerModal** (text references a "+ button" that doesn't exist inside the modal) — replace with `entries.dayPicker.noCardsYet` OR remove the `<p>` and let the inline-create button stand on its own.
- **S08: wire `<Toaster />` globally** (carried from S03 + now also S05 entry create/delete) — toast success/error on entry mutations.
