# HourTrack — Performance Notes

> **Source sprint:** S23 (Post-V2 polish — perf + architecture cleanup).
> **Purpose:** capture the load-bearing performance invariants so a future
> contributor doesn't accidentally reintroduce the regressions S23 closed.

## Bundle budget — `dist/assets/index-*.js` ≤ 500 KB raw

The main chunk is the cold-start surface for the authed user on `/`. Anything
that lands in it pays the TTI cost on every fresh load.

> **Caveat since Vite 8 (Rolldown):** the `index` chunk is no longer the
> whole cold-start payload — Rolldown auto-splits into many sibling chunks.
> See "Vite 8 / Rolldown" below before reading the raw `index-*.js` number
> as the budget.

**Rules**

- Routes that are NOT part of the home view (`/login`, `/day/:date`,
  `/reports`, `/settings`) are `React.lazy` in `apps/web/src/app/routes.tsx`.
  See `RouteSuspense` for the shared fallback. If you add a new route, default
  to lazy unless you have a concrete reason it must paint synchronously on
  `/`.
- Locale JSONs are dynamically imported via
  `i18next-resources-to-backend` (`apps/web/src/lib/i18n.ts`). Adding a new
  language = a new dynamic-import branch, NOT an extra static `import`.
  `main.tsx` awaits `loadInitialLocale()` before `render(...)` so first
  paint sees populated strings.
- The Vite `manualChunks` block in `vite.config.ts` is curated:
  `dexie`, `date-fns`, `@radix-ui` get their own chunks because both `/`
  and `/reports` import them. **Do NOT split `@tanstack/react-query` into
  its own chunk** — the QueryClient identity is a module-level singleton,
  and a separate chunk breaks it across lazy boundaries. The S13 comment
  at `vite.config.ts:36-42` is load-bearing.

**Future raises**

If a future sprint legitimately needs to grow the index chunk (e.g.
re-introduces charts, adds a fifth locale, ships a new home-only feature
that's transitively heavy), raise the budget IN THE SAME COMMIT that
ships the regression — not retroactively. The build assertion (planned
in `vite.config.ts` post-S23 verification) is the forcing function.

## S25 — `@dnd-kit` bundle decision + drag-sensor invariants

> **Source sprint:** S25 (Drag-and-Drop Entry Reschedule). Stage-0 spike
> decisions (S0a/S0b/S0c) recorded here as the forcing-function doc.

### S0a — `@dnd-kit/core` × React 19 compat: PASS

`@dnd-kit/core@6.3.1` + `@dnd-kit/utilities@3.2.2` (pinned EXACT) mount
cleanly under React 19.2.7 + `<StrictMode>` — no peer-dep error (peer is
`react >=16.8.0`), no StrictMode double-invoke / ref warnings, no console
errors. Verified via a throwaway spike test (`DndContext` + `useDraggable`

- `useDroppable` rendered in StrictMode, asserting zero `console.error` /
  `console.warn`). The spike was deleted; the shipped coverage is the pure
  resolver + `onDragEnd` unit tests + Playwright e2e. We use the established
  `@dnd-kit/core` (NOT the `@dnd-kit/react` rewrite) — the classic API is
  the battle-tested one and satisfies React 19 already.

### S0b — touch scroll-vs-drag sensor strategy (LOAD-BEARING)

**Use `MouseSensor` + `TouchSensor` as SEPARATE sensors — never `PointerSensor`,
and do NOT drop the `delay`.** The sensor configuration in `useEntryDrag.ts` is
the mechanism that lets a finger-swipe still SCROLL the agenda/columns while a
deliberate press-and-hold starts a drag (UR-25-2):

- `MouseSensor` with `activationConstraint: { distance: 8 }` — snappy mouse
  drag on desktop; no delay needed because mouse has no scroll-vs-drag
  ambiguity.
- `TouchSensor` with `activationConstraint: { delay: 220, tolerance: 8 }`
  — a swipe that moves >8px before 220 ms is interpreted as a scroll (drag
  never activates); a hold past 220 ms within 8 px starts the drag.
- `KeyboardSensor` — a11y pick-up/move/drop.

**Why NOT `PointerSensor` (post-release BF, root cause):** `PointerSensor`
handles ALL pointer types, touch included. Registered alongside `TouchSensor`
(as it originally was) it races the same finger — and with `distance: 8` / no
delay it tries to activate on movement. On the scrollable agenda the browser
claims that single-finger gesture for scrolling and fires `pointercancel`, so
the pending drag dies before the 220 ms `TouchSensor` hold can win. Net effect
on device: one-finger drag is dead; only a two-finger hold (which the browser
does NOT treat as a scroll) let anything drag-like appear. dnd-kit's documented
guidance is exactly this — use `MouseSensor` + `TouchSensor` when mouse and
touch need different activation, not `PointerSensor`. **Do not reintroduce
`PointerSensor`** (guarded by a test in `useEntryDrag.test.ts`).

Because the touch delay gates activation, we do **NOT** apply a blanket
`touch-action: none` to chips (that is exactly what would kill list scroll).
A `select-none` / `-webkit-touch-callout: none` is still applied to draggable
chips to suppress the native long-press text-selection/Copy callout, but that
is a separate hardening — it does NOT change `touch-action`, so agenda scroll
is preserved. A future contributor who "fixes" the delay to make desktop
snappier, or who swaps back to `PointerSensor`, will reintroduce either the
UR-25-2 scroll regression or the dead-touch-drag BF. Use the `distance`
constraint on the `MouseSensor` for desktop snappiness instead.

### S0c — bundle impact decision: ACCEPT growth + restate budget

**Baseline (dnd-kit installed but unimported):** `dist/assets/index-*.js`
**652.53 KB raw / 195.88 KB gzip** (vite `chunkSizeWarningLimit` is 600;
the ≤ 500 KB raw target from the top of this doc is an open S24 followup,
NOT met since S17). The calendar surface (MonthView/WeekView) is **eager**
on `/` (S23 routes.tsx kept Home eager on purpose — `/` is the cold-start
surface and lazy-loading it would add a Suspense round-trip before first
paint of the primary view).

Two options were on the table (S0c): (a) lazy-split the calendar off the
index chunk, or (b) accept the growth + restate the budget. **Chose (b)**
because (a) directly contradicts the S23 eager-Home invariant — the
calendar IS the home view, so deferring it behind Suspense regresses the
exact cold-start metric S23 optimised. dnd-kit's ~12 KB gzip is a far
smaller cold-start cost than a Suspense round-trip on `/`.

**Restated budget (S25):** the index chunk grows by the dnd-kit delta
(measured post-implementation below). The ≤ 500 KB raw aspirational target
remains an S24 followup; the dnd-kit move does not regress it relative to
the real 652 KB baseline beyond the library's own footprint. The S24
bundle-shrink sprint (move `lib/google/*` + `SyncManager` behind a dynamic
auth-gated import) is where the index chunk gets back under target — dnd-kit
is in scope for that lazy boundary too if needed.

**Measured S25 delta:** post-implementation `dist/assets/index-*.js` is
**699.70 KB raw / 211.58 KB gzip** (was 652.53 KB / 195.88 KB at the S25
baseline) → **+47.17 KB raw / +15.70 KB gzip**. That covers `@dnd-kit/core`

- `@dnd-kit/utilities` + `@dnd-kit/accessibility` (the bulk, ~30-40 KB raw)
  plus the S25 UI/hook/i18n code (useEntryDrag, the draggable/droppable wiring
  across EntryChip/DayCell/MonthView/WeekView/WeekAgendaView, the editor date
  field, and the move/dnd/announcement strings). The chunk remains over vite's
  600 KB warn limit and the aspirational ≤ 500 KB target — both pre-existing,
  both still owned by the S24 bundle-shrink followup (lazy auth-gated
  `lib/google/*` + `SyncManager`). dnd-kit should be considered for that lazy
  boundary too if the calendar is ever split.

## Vite 8 / Rolldown — the index chunk is no longer the whole cold-start surface

> **Source:** build-chain upgrade Vite 6 → 7 → 8. Vite 8 replaces the
> Rollup + esbuild pipeline with **Rolldown** (`rolldown@1.x`).

The `≤ 500 KB raw index-*.js` budget above was written when Rollup emitted a
single monolithic `index` chunk that WAS the cold-start payload. Rolldown
changes that model, so read the budget accordingly.

**What changed, measured on this repo:**

| Bundler           | `index-*.js` raw / gzip | Shape                                |
| ----------------- | ----------------------- | ------------------------------------ |
| Rollup (vite ≤7)  | ~687 KB / ~209 KB       | one monolith + curated manualChunks  |
| Rolldown (vite 8) | ~344 KB / ~106 KB       | index + many auto-split named chunks |

Rolldown's automatic code-splitting is far more aggressive: instead of one
big `index`, it emits additional shared chunks named after a module
(`button-*.js`, `EmptyState-*.js`, `date-*.js`, `LanguageSwitcher-*.js`, …),
several 50–128 KB each. Total first-party JS is ~1.06 MB raw across ~18
chunks — roughly the same code, distributed differently. **The `index`
number dropping to 344 KB is NOT a real cold-start win**; the auto-split
chunks are static imports of the home route and load alongside it.

**Rules under Rolldown:**

- The curated `manualChunks` block in `vite.config.ts` (`dexie`, `date-fns`,
  `@radix-ui`) still applies — Rolldown honors `rollupOptions.output`.
- **The `@tanstack/react-query` single-instance invariant survived the
  re-chunk** — verified because every route (incl. lazy `/reports`,
  `/settings`) renders in the e2e suite with no "No QueryClient set" throw.
  If you touch `manualChunks`, re-run e2e; a build-green split can still
  break the singleton at runtime.
- **Budget interpretation:** `index-*.js ≤ 500 KB` is now met with wide
  headroom but is no longer a faithful proxy for cold-start weight. Track
  the SUM of `index` + its statically-imported sibling chunks (everything
  the browser pulls on `/` before any lazy route), not `index` alone. The
  planned build assertion should assert on that sum.
- The `[PLUGIN_TIMINGS]` warning at build time (`visualizer ~47%`) is
  informational — the treemap at `dist/stats.html` still generates.

## Range cache strategy — surgical patches for calendar, invalidate for reports

`useEntriesInRange` (`apps/web/src/features/calendar/useEntriesInRange.ts`)
returns an `EntriesInRangeData` with `entries`, `entriesByDate`,
`entriesByCard`, `cardsById`. Multiple of these caches are live
simultaneously while the user navigates months and the Reports surface
mounts in parallel.

**Rules**

- Entry mutations (`useCreateEntryMutation`, `useUpdateEntryMutation`,
  `useDeleteEntryMutation` in `apps/web/src/features/entries/useEntries.ts`)
  use `patchEntryInRangeCaches(qc, entry, op)` to mutate every cached
  calendar range in place. Untouched dates keep their bucket array
  reference — this is what makes `memo(DayCell)`'s comparator effective.
- **Date-change updates** (`May 14 → May 21`): the helper handles the
  remove-from-old-bucket-and-insert-at-new case inside a single range
  cache. There's a dedicated test for it; don't refactor away.
- Reports-shape caches (`['entries', 'range', 'reports', ...]`, 7-element
  keys with the `'reports'` discriminator at index 2) are SKIPPED by the
  patcher. They store an aggregated `{ byEntry, byCard, totals }` shape
  whose rebuild would require duplicating `computeReport` logic
  (including monthly-retainer per-entry denominator math). Those caches
  are INVALIDATED via `invalidateQueries({ queryKey: ['entries', 'range',
'reports'] })`. The 3-element prefix matches every Reports query
  regardless of trailing filter inputs.
- **Don't change the cache key shape without also updating the helpers.**
  The `isReportsRangeKey` check at `useEntries.ts` looks specifically at
  index 2. If you reorder elements (e.g. move `'reports'` later), the
  helper will silently treat Reports caches as calendar caches and try
  to patch them, which crashes the consumer.

## `memo(DayCell)` + `memo(EntryChip)` — reference equality only

Both components are wrapped in `React.memo`. `DayCell` has an explicit
comparator (`dayCellPropsEqual`) covering every prop key.

**Rules**

- The comparator is **reference-only**. It assumes:
  - `entries`/`cardsById`/`entriesByCard` are produced by
    `useEntriesInRange` and stay stable across mutations that don't
    touch the relevant bucket. After S23 Part C's surgical patches,
    this holds. If a future change reverts to coarse
    `invalidateQueries({ queryKey: ['entries', 'range'] })`, every
    cell re-renders on every entry edit — at which point the memo is
    paying overhead for nothing.
  - `onClick`/`onEntryEdit` are stabilised at the parent via
    `useCallback` (see MonthView/WeekView).
- **If you add a new prop to `DayCellProps`**, update `dayCellPropsEqual`.
  The comparator-drift mitigation sketched in the sprint Notes (a TS-level
  test asserting every prop key is referenced in the comparator) was
  deferred to keep S23 in scope — adding it is a future cleanup.

## Reports scope — conditional widening

`useReportData` (`apps/web/src/features/reports/useReportData.ts`)
widens the entries query to the surrounding full calendar months ONLY
when at least one card has `rateType === 'monthly'` AND non-null
`monthlyTotal`. This is needed because the per-entry monthly retainer
share is `monthlyTotal / count(non-custom entries in this card's full
month)` — the denominator requires entries outside the visible filter
window.

For every other rate type, the widening was wasted Dexie work. The
`hasMonthlyCard` boolean is part of the query key so two sessions with
different card populations don't collide on the same cache row.

## Settings query — `staleTime: Infinity`

`useSettingsQuery` reads the singleton `Settings` row. The row only
changes via the explicit `useUpdateSettingsMutation` in the same file,
which writes through `setQueryData` + invalidates the key. Without
`staleTime: Infinity`, every component that mounts the hook
(ThemeManager, InterfaceSection, useDefaultViewSync, ...) refetches
after 30s for no reason. The mutation's invalidate still triggers a
fresh read when settings actually change.

## Snapshot diff — fingerprint not JSON.stringify

`bootstrap.snapshotsEqual` computes divergence between two snapshots via
`fingerprintById(rows)` (per-row `id + '\0' + updatedAt`, sorted, joined
with `'\0'`). This avoids JSON.stringify's O(N) string allocation on
each call — for a user with thousands of entries that was ~150 KB per
call, twice. The fingerprint is sufficient because LWW merge is
deterministic from `(id, updatedAt)` alone, so two snapshots with
identical multisets of those pairs MUST produce identical merge results
and are equal for divergence-detection purposes.

## S29 Task 12 — stable calendar callbacks re-arm the `memo(DayCell)` bailout

`useDayClickFlow` returns `handleDayClick`, `createEntryForCardOnDate`, and
`confirmDelete`. These are passed to every `DayCell` (the calendar renders
~42 cells in month view). Before S29 they were re-created on every render, so
their reference identity changed each time the parent re-rendered — which
defeated the `memo(DayCell)` bailout added in S23/S25 (the audit found the
optimization was silently inert). Wrapping them in `useCallback` restores
stable identities so a drag pick-up (which re-renders the calendar parent)
no longer cascades a re-render into all ~42 cells.

**Manual verification (deferred to the user):** the "drag pick-up no longer
re-renders every cell" check requires the React DevTools Profiler in a real
browser and cannot run in the headless CI/agent environment. To confirm:
open the app, start a React Profiler recording, pick up an entry chip on the
month view, stop the recording, and verify that only the source/target
`DayCell`s (and the drag overlay) show render commits — not the full grid.
The code change (this commit) is what enables it; the Profiler trace is the
observation step.

## S31 Task 19 — PWA update flow: `registerType: 'autoUpdate'` (accepted)

`vite-plugin-pwa` is configured with `registerType: 'autoUpdate'`. On a new
deploy the fresh service worker activates and reloads the page. The audit
(2026-07-17) flagged that this can drop unsaved input mid-edit (EntryEditor /
CardForm) if a deploy lands exactly while the user is typing.

**Decision (S31): keep `autoUpdate`.** For a single-user personal tool where
deploys are infrequent and user-controlled (the user owns the fork and the
Vercel project), the reload window is tiny and the "always run the latest
build" guarantee outweighs the rare mid-edit interruption. The alternative —
`registerType: 'prompt'` plus a localized "New version available — reload"
toast/affordance so the user chooses when to reload — is a genuine feature
(new UI + i18n + update-detection wiring) and is filed as **backlog**, to be
picked up only if the drop-input case is ever observed in practice.

## Turbo pipeline — why the task graph looks the way it does

`turbo.json` carries no comments (it is strict JSON), so the reasoning behind
each key lives here.

**`dependsOn: ["^build"]` is declared on `build` only.** Today it resolves to
nothing: `packages/shared-types` and `packages/shared-utils` expose their
SOURCE (`main`/`types` -> `./src/index.ts`, and `vite.config.ts` aliases both
straight at `src/index.ts`), so they have no build step and nothing anywhere
reads a `packages/*/dist`. The edge stays on `build` so a package that later
gains a real build is wired up automatically. It is deliberately NOT on
`lint`/`typecheck`/`test` — those consume the same source, and the two
`--emitDeclarationOnly` scripts that used to satisfy the edge produced `.d.ts`
files no tool ever loaded while serializing ~5s of dead work in front of every
`apps/web` task. Isolated `turbo run build --force`: 11.3s / 3 tasks before,
6.5s / 1 task after.

**`apps/web` builds with `tsc -b --noEmit`, not `tsc -b`.** With plain `tsc -b`
the app's `composite` project emitted a full JS + `.d.ts` + sourcemap copy of
`src/` into `apps/web/dist/src/`, which the `vite build` immediately after it
wiped via `emptyOutDir`. ~4s of pure waste per build (15.7s vs 11.5s measured),
and the stale `.tsbuildinfo` defeated incremental rebuilds. Typechecking is
unchanged — `tsc -b --noEmit` still builds the whole project reference graph.

**`test.outputs` is `[]`; coverage is its own task.** `vitest run` writes no
artifacts, so declaring `coverage/**` on `test` made turbo warn "no output
files found" on every run. The `test:coverage` task owns `coverage/**`, and CI
invokes it through turbo (`turbo run test:coverage --filter=@hourtrack/web`)
so the gate is cached like everything else.

**`inputs` exclusions.** `**/*.md` is excluded everywhere so touching a README
does not invalidate a cached task. `e2e/**` and `playwright.config.ts` are
excluded from `build` and `test` only — Playwright owns that directory and
neither `vite build` nor `vitest` reads it. They are deliberately KEPT in the
`lint` and `typecheck` hashes, because `eslint .` lints them and the
`typecheck` script runs `tsc -p tsconfig.e2e.json`. Test files are NOT excluded
from `build`: `tsconfig.app.json` includes all of `src/**`, so a type error in
a test still fails the build, and the cache key has to reflect that.

**CI caches `.turbo/cache`** (`actions/cache`, keyed on lockfile + sha with a
lockfile-scoped restore prefix). Without it every CI run was a cold ~90s
pipeline even when a push touched one file; turbo's cache only ever helped
locally.

## Vitest config — build-time plugins are not merged in

`apps/web/vitest.config.ts` used to be `mergeConfig(viteConfig, ...)`, which
pulled every build-time plugin into the test run: **VitePWA** (service-worker
and manifest generation — `devOptions` are off and vitest never builds an
`index.html`), the **rollup visualizer** (a pure `generateBundle` hook, build-
only by definition), and **`@tailwindcss/vite`** (a CSS transform, dead here
because `css: false` means vitest never hands it a stylesheet) — plus
`build.rollupOptions.manualChunks` and the dev-server `port`/`strictPort`.

The config now declares only what tests need: `react()` for the JSX transform,
plus `define` and `resolve` taken **by reference** off the imported
`viteConfig` so the `__APP_VERSION__` define and the `@/*` + `@hourtrack/*`
aliases cannot drift from the app config.

> **This was not a speedup.** Measured over 5 runs, before: 67.2s / 79.7s;
> after: 76.6s / 75.7s / 77.1s — the run-to-run spread on an _unchanged_
> config is wider than the difference. In test mode those plugins are
> effectively no-ops. Keep the change for the cleaner build/test boundary, and
> do not cite it as a performance win. The real cost is elsewhere: `import`
> ~440s and `environment` ~150s summed across workers, i.e. instantiating
> happy-dom for each of 115 files. Moving the pure-logic suites (`src/lib/**`)
> to `environment: 'node'`, or relaxing `isolate`, is the lever that would
> actually move it — both change test semantics, so neither is done here.
