# Implementation Plan: Break feature import cycles

**Spec**: `specs/005-feature-cycles/spec.md`

## Technical Context

React 19 + TS 6, Vitest. Moves use the scratchpad move tool (`move-modules.mjs`, rewrites
specifiers incl. `vi.mock`, then `git mv`). No new dependencies.

## Constitution Check

No constitution file with filled principles; project rules (CLAUDE.local.md): FeatureBandit stages,
gate `pnpm lint && pnpm typecheck && pnpm test`, no push/PR. Internal refactor → no version bump.

## Design

1. **Moves** (one move-map): `features/backup/validateSnapshot{,.test}.ts` → `lib/sync/`;
   `features/sync/handlers/calendarOps{,.test,.reminders.test}.ts` → `features/calendar-sync/`;
   `features/sync/SyncIndicator{.tsx,.test.tsx}` → `features/backup/`;
   `features/calendar/useEntriesInRange{.ts,.test.tsx}` → `features/entries/`.
   `lib/sync/validateSnapshot` may import `@/lib/db/constants` (lib → lib).
2. **SyncOrchestrator**: component returning `null`; reads `tokens` from `useAuth()`; holds the
   session-keyed `bootstrapRanRef` effect verbatim and the `subscribeSnapshotApplied` effect.
   `AuthProvider` loses both effects and its `@/features/sync/*` imports. Mounted in
   `app/routing/router.tsx` inside `<AuthProvider>`.
3. **Graph test**: walk `src/features/**/*.{ts,tsx}` minus tests, collect `@/features/<x>/` and
   relative `../<x>/` specifiers (static `from`, `import()`), build feature → feature edges, DFS for
   a cycle, report the path.

## Risks

- Bootstrap toasts use `t` — the orchestrator sits under the i18n provider like `AuthProvider`
  does (same tree position) — no change.
- Moving `SyncIndicator` changes no rendering; its test moves with it.
