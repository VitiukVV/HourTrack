# HourTrack — Performance Notes

> **Source sprint:** S23 (Post-V2 polish — perf + architecture cleanup).
> **Purpose:** capture the load-bearing performance invariants so a future
> contributor doesn't accidentally reintroduce the regressions S23 closed.

## Bundle budget — `dist/assets/index-*.js` ≤ 500 KB raw

The main chunk is the cold-start surface for the authed user on `/`. Anything
that lands in it pays the TTI cost on every fresh load.

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

**Do NOT collapse these into a single `PointerSensor`, and do NOT drop the
`delay`.** The sensor configuration in `useEntryDrag.ts` is the mechanism
that lets a finger-swipe still SCROLL the agenda/columns while a deliberate
press-and-hold starts a drag (UR-25-2):

- `TouchSensor` with `activationConstraint: { delay: 220, tolerance: 8 }`
  — a swipe that moves >8px before 220 ms is interpreted as a scroll (drag
  never activates); a hold past 220 ms within 8 px starts the drag.
- `PointerSensor` with `activationConstraint: { distance: 8 }` — snappy
  mouse drag on desktop; no delay needed because mouse has no scroll-vs-drag
  ambiguity.
- `KeyboardSensor` — a11y pick-up/move/drop.

Because the touch delay gates activation, we do **NOT** apply a blanket
`touch-action: none` to chips (that is exactly what would kill list scroll).
A future contributor who "fixes" the delay to make desktop snappier, or who
swaps to a single PointerSensor, will reintroduce the UR-25-2 failure mode
(swipe can no longer scroll the agenda). Use the `distance` constraint on
the mouse sensor for snappiness instead.

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

**Measured S25 delta:** see the S25 journal entry's Bundle section for the
exact post-implementation raw/gzip numbers.

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
