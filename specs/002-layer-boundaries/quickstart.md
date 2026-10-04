# Quickstart: validate layer boundaries

1. Gate (repo root): `pnpm lint && pnpm typecheck && pnpm test` and `pnpm build` — all pass.
2. No `components → features` imports left:
   `grep -rn "@/features/" apps/web/src/components --include=*.tsx | grep -v test` → empty.
3. One error per edge (SC-002) — temporarily add, run `pnpm --filter @hourtrack/web lint`, revert:

   | File                                      | Throwaway import                                   | Expected rule message |
   | ----------------------------------------- | -------------------------------------------------- | --------------------- |
   | `apps/web/src/lib/utils.ts`               | `import '@/features/cards/useCards';`              | lib is bottom layer   |
   | `apps/web/src/lib/utils.ts`               | `import '../features/cards/useCards';`             | lib is bottom layer   |
   | `apps/web/src/features/cards/useCards.ts` | `import type {} from '@/app/router';`              | not pages/app         |
   | `apps/web/src/components/EmptyState.tsx`  | `import '@/features/cards/useCards';`              | components ↛ features |
   | `apps/web/src/pages/Home.tsx`             | `import '@/lib/db/schema';`                        | pages ↛ schema        |
   | `apps/web/src/lib/utils.test.ts` (any)    | `import '@/features/cards/useCards';`              | no error (test)       |
