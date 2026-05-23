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
