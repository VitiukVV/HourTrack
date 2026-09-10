# Implementation Plan: Cards — user-defined order + richer colour choice

**Branch**: `feature/cards-order-and-colors` | **Date**: 2026-09-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-cards-order-colors/spec.md`

## Summary

Two user-facing changes to the card row. First, cards gain a user-defined order: a new
fractional `position` field on `Card`, a press-and-hold drag in `CardsHeader` built on the
sensor recipe already proven for calendar drag, and a single ordered query that every card
list reads from. Second, the closed 12-colour palette becomes twelve presets plus a custom
hex, which forces three linked changes: a real contrast-ratio label rule (flipping seven
preset labels from white to dark, accepted by the user), a corrected sky-blue preset that can
actually pass 4.5:1, and a nearest-neighbour rule mapping any custom colour onto Google
Calendar's eleven event colours instead of falling back to grey.

Both halves are one Dexie version bump (`8 → 9`) and one Drive snapshot bump (`5 → 6`), so
they ship together rather than as two migrations.

## Technical Context

**Language/Version**: TypeScript 5.x, React 19, Vite 8

**Primary Dependencies**: Dexie 4 (IndexedDB), TanStack Query 5, Zustand 5, Tailwind v4 +
shadcn/ui, react-hook-form + Zod, i18next, `@dnd-kit/core@6.3.1` + `@dnd-kit/utilities@3.2.2`
(exact-pinned), **new**: `@dnd-kit/sortable@10.0.0` (exact-pinned, peers core `^6.3.0`)

**Storage**: Dexie/IndexedDB is the source of truth; one `data.json` snapshot on Google Drive
(`appDataFolder`) for cross-device sync; Google Calendar receives entry events

**Testing**: Vitest (happy-dom + fake-indexeddb) colocated with sources, Playwright e2e
(`chromium` + `mobile-iphone-13`) with axe; `scripts/i18n-check.mjs` enforces uk/en/es key
parity

**Target Platform**: installable PWA, phone-first (primary device), also desktop browsers

**Project Type**: client-only monorepo web app — no backend, no server-side state

**Performance Goals**: reorder feels immediate (optimistic local write, sync in background);
no regression to the calendar drag surfaces that share the dnd-kit pin

**Constraints**: offline-capable (every write lands in Dexie first and replays from the sync
queue); per-row LWW merge is the only conflict mechanism available; label contrast ≥ 4.5:1
for every preset after this change

**Scale/Scope**: single user per install, a handful of cards, three locales, two touched
features (`cards`, `calendar-sync`) plus the shared `colors`/`queries`/snapshot layers

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled Spec Kit template — this project has no
ratified constitution, so there are no constitutional gates to evaluate. The project rules
that actually bind this work are in `CLAUDE.local.md` and `docs/DEPENDENCY_POLICY.md`, and
they are treated as gates here:

| Rule | Source | How this plan satisfies it |
| --- | --- | --- |
| User-visible change ⇒ version bump + changelog entry in all three locales | `CLAUDE.local.md` | Dedicated task at the end of implementation: `apps/web/package.json` minor bump and a `CHANGELOG_RELEASES` entry with `whatsNew.releases.*` text in `en`/`uk`/`es` |
| New persisted field ⇒ Dexie version bump + snapshot `schemaVersion` + `validateSnapshot` + LWW merge | project memory / existing schema history | `position` is carried through all four in one coordinated change (D1, D2) |
| dnd-kit versions are taken deliberately, exact-pinned, drag surfaces smoke-tested | `docs/DEPENDENCY_POLICY.md` | `@dnd-kit/sortable` added exact-pinned at `10.0.0`, listed in the policy's pinned block, and the calendar drag surfaces are re-tested because they share the pin |
| i18n key parity across uk/en/es | `src/lib/i18n.test.ts` + `scripts/i18n-check.mjs` | Every new string (drag announcements, custom-colour labels, contrast warning) is added to all three locales in the same task |

**Post-design re-check**: no violation introduced. One new runtime dependency is added, with
its justification recorded in [research.md](./research.md) D3 and reflected in the dependency
policy.

## Project Structure

### Documentation (this feature)

```text
specs/001-cards-order-colors/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — decisions D1..D8 with measured basis
├── data-model.md        # Phase 1 — Card.position, colour field, migrations
├── quickstart.md        # Phase 1 — how to validate the feature end to end
├── contracts/
│   ├── card-ordering.md # Ordering + migration + merge contract
│   └── card-colour.md   # Colour field, label rule, Calendar mapping contract
└── checklists/
    ├── requirements.md  # Spec-quality checklist (passing)
    ├── ux.md            # Touch/a11y/colour requirements-quality review
    └── data.md          # Persistence/sync/upgrade requirements-quality review
```

### Source Code (repository root)

```text
apps/web/src/
├── lib/
│   ├── colors.ts                      # CARD_COLORS (Sky hex corrected), contrast-ratio
│   │                                  # label rule, hex validation, nearest Calendar colour
│   └── db/
│       ├── schema.ts                  # Dexie version(9): position backfill + Sky migration
│       └── queries.ts                 # getCardsOrdered / getArchivedCardsOrdered,
│                                      # reorderCard transaction, relaxed assertCardShape
├── features/
│   ├── cards/
│   │   ├── CardsHeader.tsx            # DndContext + SortableContext around the chip row
│   │   ├── SortableCardChip.tsx       # NEW — useSortable wrapper, drag-vs-tap guard
│   │   ├── CardChip.tsx               # drag styling hooks, unchanged label logic
│   │   ├── ColorPicker.tsx            # presets + custom swatch + hex field + warning
│   │   ├── cardSchema.ts              # colour: hex regex instead of palette membership
│   │   ├── useCards.ts                # useReorderCardsMutation; position-only change must
│   │   │                              # NOT enqueue bulkUpdateCardEvents
│   │   └── ArchivedCardsList.tsx      # ordered list, restore appends to the end
│   ├── calendar-sync/
│   │   └── buildEvent.ts              # nearest-colour resolution replaces `?? '8'`
│   ├── reports/useReportData.ts       # ordered query, keeping its showArchived flag
│   ├── entries/DayPickerModal.tsx     # read through the ordered query
│   └── onboarding/OnboardingProvider.tsx
├── features/backup/validateSnapshot.ts # schemaVersion 6 + upgradeV5ToV6 backfill
├── features/sync/lwwMerge.ts           # position carried through the merge, (position, id)
└── lib/sync/snapshot.ts                # position in the written snapshot

apps/web/e2e/                            # reorder persistence + custom colour journeys
packages/shared-types/src/card.ts        # Card.position, colour doc no longer "12 fixed"
docs/PROJECT_PLAN.md                     # §7.5 palette contract rewritten
docs/DEPENDENCY_POLICY.md                # @dnd-kit/sortable added to the pinned block
apps/web/src/features/whats-new/changelog.ts + locales  # release entry
```

**Structure Decision**: the existing feature-folder layout is kept as is. The only new file
is `SortableCardChip.tsx`, which isolates the dnd-kit wiring so `CardChip` stays a
presentational pill and its current tests keep passing unchanged.

## Phase ordering

The work splits into two independently shippable slices matching the spec's priorities, plus
a shared foundation:

1. **Foundation** — colour helpers and the ordered query/migration groundwork that both
   slices need (`lib/colors.ts`, `lib/db/schema.ts` v9, `queries.ts`, snapshot v6, merge).
2. **Slice A (US1 + US3, P1/P3)** — reorder interaction and every list reading the order.
3. **Slice B (US2, P2)** — custom colour, picker, contrast warning, Calendar mapping.
4. **Release** — version bump, changelog in three locales, docs contract rewrite.

Slice A and Slice B both depend on the foundation but not on each other, so either can land
first if the other stalls.

## Complexity Tracking

No constitutional violations to justify. Two decisions worth recording because they add
surface area deliberately:

| Decision | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| New dependency `@dnd-kit/sortable` | Horizontal sortable list with touch/keyboard parity | Hand-rolling droppable slots on `@dnd-kit/core` puts bespoke pointer maths in the exact area `DEPENDENCY_POLICY.md` records as this project's DnD regression hotspot |
| Fractional `position` instead of a dense index | One row written per move, so per-row LWW resolves cleanly | A dense index rewrites every row after the moved one, producing ambiguous multi-row conflicts on a two-device merge |
