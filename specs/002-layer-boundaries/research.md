# Research: Layer boundaries enforced by lint

## R1 — Rule mechanism

- **Decision**: built-in `no-restricted-imports` with `patterns: [{ group, message }]`, one config
  block per edge, `ignores: ['**/*.test.*']` (my-diary `layerBoundary()`).
- **Rationale**: no new dependency; proven in my-diary; message per edge. Blocks per edge do not
  merge: ESLint flat config replaces a rule's options when a later block for the same file sets
  it again, so a file in two edge sets (e.g. `components/**` is in FR-002 and FR-003) must get one
  block with both groups. Plan: build `components` as a single block (pages/app/features).
- **Alternatives**: `eslint-plugin-boundaries` / `import/no-restricted-paths` — more expressive,
  but a new dependency for four edges.

## R2 — Matching alias and relative forms

- **Decision**: per directory, patterns `@/<dir>/**` and `**/../<dir>/**` (my-diary `srcDirs()`),
  plus the bare `@/<dir>` is not needed (no barrel `index.ts` at layer roots).
- `import type` is matched by `no-restricted-imports` by default (`allowTypeImports` off).

## R3 — Vendor ignore

- **Decision**: replace `apps/web/src/components/ui/**` with the seven shadcn files
  (`button`, `dialog`, `dropdown-menu`, `input`, `popover`, `select`, `switch`).
- **Risk**: the four own components become linted under `--max-warnings=0`; fix any findings in
  the same task.

## R4 — `calendarLocale` target

- **Decision**: `lib/calendarLocale.ts` (flat) now; step 2 of the audit regroups `lib/`.
- **Alternative**: `lib/i18n/calendarLocale.ts` — would collide with the existing `lib/i18n.ts`
  file and the `@/lib/i18n` import; deferred to step 2.
