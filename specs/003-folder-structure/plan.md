# Implementation Plan: Folder structure of app, pages and lib

**Branch**: `feature/architecture-refactor` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary

Move ~45 files with `git mv` into role folders and rewrite every path reference with one
scripted pass, so the move is mechanical and repeatable.

## Technical Context

**Language/Version**: TypeScript 6, React 19, Vite 8, Vitest
**Testing**: full gate + build; test count must stay 1239
**Constraints**: zero behaviour change; lint layer rules (spec 002) keep passing
**Scale/Scope**: `src/app` (16 files), `src/pages` (11), `src/lib` loose files (18)

## Constitution Check

Template constitution — no gates. `CLAUDE.local.md`: internal change, no version bump. Pass.

## Move map

```text
app/shell/      AppLayout(+test) DbInterruptedScreen(+test) ErrorBoundary(+test) ErrorScreen
                RequireAuth(+test) useStickyChromeHeight
app/routing/    router  routes(+test)  useScrollRestoration(+test)
app/providers/  queryClient
pages/day/      DayPage(+test)          pages/home/      Home
pages/login/    Login(+test)            pages/payments/  Payments
pages/reports/  Reports                 pages/settings/  Settings(+test)
pages/whats-new/ WhatsNew(+test)
lib/i18n/       i18n  i18n.test  i18n.plurals.test  zodI18n  calendarLocale
lib/utils/      utils  date(+test)  timeOfDay(+test)  noAutofill(+test)  scroll(+test)
lib/ui/         colors(+test)
```

## Research / decisions

- **Rewrite tool** (`scratchpad/move-modules.mjs`, not committed): for every `.ts/.tsx` under
  `src/` and `e2e/`, find module specifiers in `from '…'`, `import '…'`, `import('…')`,
  `vi.mock/doMock/importActual('…')`; resolve each (alias `@/` or relative) to a file; if the
  target or the importing file moved, re-emit the specifier in the same style (alias stays
  alias, relative is recomputed from the new location). Reused by later audit steps.
- `import.meta.glob('../**/*.tsx')` in `noAutofill.test.ts` is a glob, not a module → fixed by
  hand to the new depth.
- `components.json` `aliases.utils` → `@/lib/utils/utils`; `vitest.config.ts` coverage
  `src/lib/**` still matches; its `src/lib/i18n/**` exclude now actually applies.
- No `index.ts` barrels (they would bypass the spec 002 bare-dir rule and blur ownership).
