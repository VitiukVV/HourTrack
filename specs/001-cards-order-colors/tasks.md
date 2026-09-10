---
description: 'Task list for cards user-defined order + richer colour choice'
---

# Tasks: Cards — user-defined order + richer colour choice

**Input**: Design documents from `specs/001-cards-order-colors/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Included. The flow this project follows is test-first, so within every unit of behaviour the test task precedes its implementation task.

**Organization**: Grouped by user story. Phases 3–5 follow the spec's priority order (P1 → P2 → P3); US3 only depends on the foundation, so it can be pulled forward next to US1 as [plan.md](./plan.md) slices it.

**Revision**: corrected after `/speckit-analyze` — query signatures now match the `queries.ts` convention (I1), reports keep their archived-cards option (I2), the non-existent "card management" surface is replaced by the real ones (U1), and FR-014's visible feedback has its own tasks (C1).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All paths are repository-relative

## Path Conventions

Monorepo: app code under `apps/web/src/`, shared types under `packages/shared-types/src/`, e2e under `apps/web/e2e/`. Vitest specs are colocated next to their source.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the one new dependency, taken deliberately per the dependency policy

- [X] T001 Add `@dnd-kit/sortable` at exact version `10.0.0` (no caret) to `apps/web/package.json` dependencies next to the existing pinned `@dnd-kit/core@6.3.1` / `@dnd-kit/utilities@3.2.2`, then run `pnpm install` and confirm the lockfile records exactly that version
- [X] T002 Extend the `@dnd-kit` bullet in `docs/DEPENDENCY_POLICY.md` §Special cases to cover `@dnd-kit/sortable`, stating why it is exact-pinned and that card-row reorder joins the drag surfaces to smoke-test before any `@dnd-kit` bump

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the colour helpers, the persisted `position`, the ordered queries, the snapshot version and the merge behaviour that both user stories build on

**⚠️ CRITICAL**: no user story work starts until this phase is green

### Colour helpers

- [X] T003 [P] Write failing tests in `apps/web/src/lib/colors.test.ts` for the contrast-ratio label rule: `getReadableTextColor` returns the higher-contrast of `#FFFFFF` / `#0F172A`, every one of the twelve presets reaches ≥ 4.5:1 with its returned label, malformed input returns `#0F172A`, and the seven documented flips (orange, amber, banana, lime, basil, teal) now return dark — table of expected values from [research.md](./research.md) D5
- [X] T004 [P] Write failing tests in `apps/web/src/lib/colors.test.ts` for `getLabelContrast` (returns `{ color, ratio }`), `isValidHexColor` (accepts `#RRGGBB` in either case, rejects 3-digit, named, empty and `rgb()` forms) and `resolveCalendarColorId` (each preset maps to its curated `colorId` including the three deliberate collisions; the retired `#0284C7` still resolves to `'7'` via nearest-neighbour; a non-preset hex resolves to the nearest Google colour; equal distances break to the lower `colorId`; malformed hex returns `'8'`)
- [X] T005 Implement the colour layer in `apps/web/src/lib/colors.ts`: replace the sky-blue preset `#0284C7` with `#0C74B0` **and rename its `GOOGLE_CALENDAR_COLOR_MAP` key to match, keeping the value `'7'`**, rewrite `getReadableTextColor` on a WCAG contrast ratio, add `getLabelContrast`, `isValidHexColor`, the frozen `GOOGLE_EVENT_COLORS` constant and `resolveCalendarColorId` with a local sRGB→CIELAB ΔE76 helper — and rewrite the file header, which currently states the palette is closed
- [X] T006 [P] Opportunistically verify the eleven Google event hexes in `GOOGLE_EVENT_COLORS` against a live `GET /calendar/v3/colors` response using the app's authenticated client, and record the outcome and date in the constant's comment. **Non-blocking**: if the call cannot be made, ship the constant with its documented provenance and note that the check is outstanding — no other task waits on this

### Persisted position

- [X] T007 [P] Add `position: number` to the `Card` interface in `packages/shared-types/src/card.ts` with its ordering rules, and rewrite the `color` field doc so it no longer claims the twelve presets are the permitted values
- [X] T008 [P] Write failing tests in `apps/web/src/lib/db/dexie.upgrade.test.ts` for the v8→v9 upgrade: every card ends with a finite `position`, the resulting `(position, id)` order equals the pre-upgrade `id` order, cards holding `#0284C7` become `#0C74B0`, and no other colour value changes
- [X] T009 Implement `this.version(9)` in `apps/web/src/lib/db/schema.ts` following the shape of versions 2–8: backfill `position = index * 1024` over cards sorted by `id`, rewrite the old sky-blue hex, all inside the upgrade transaction
- [X] T010 [P] Write failing tests for the ordered query layer in a new `apps/web/src/lib/db/cardOrder.test.ts` plus `apps/web/src/lib/db/queries.assertCardShape.test.ts`: `getCardsOrdered(db)` returns active cards by `(position, id)`, `getCardsOrdered(db, true)` includes archived ones under the same comparator, `id` breaks ties on duplicate positions, `getArchivedCardsOrdered(db)` covers archived only, `nextCardPosition(db)` returns `max + 1024`, `reorderCard(db, id, toIndex)` writes the midpoint of the new neighbours and bumps `updatedAt`, is a no-op for an unchanged index, clamps an out-of-range index, and renormalises to `index * 1024` when the gap would fall below `1e-3`; `assertCardShape` accepts any `#RRGGBB` and requires a finite `position`
- [X] T011 Implement `getCardsOrdered`, `getArchivedCardsOrdered`, `nextCardPosition` and `reorderCard` in `apps/web/src/lib/db/queries.ts` — each taking the db handle first, matching `getAllCards(db, includeArchived)` — relax `assertCardShape` to the hex regex plus the `position` check, make `createCard` and `restoreCard` assign `nextCardPosition(db)`, and export the new functions from `apps/web/src/lib/db/index.ts`

### Snapshot and merge

- [X] T012 [P] Write failing tests in `apps/web/src/features/backup/validateSnapshot.test.ts`: a `schemaVersion: 5` snapshot upgrades in-band to 6 with `position` backfilled over cards sorted by `id` and the old sky blue rewritten, a v6 snapshot validates unchanged, a card colour that is not a valid hex is rejected, and an unknown higher version still hits the existing refusal path
- [X] T013 Implement `upgradeV5ToV6` in `apps/web/src/features/backup/validateSnapshot.ts`, chain it after the existing v2→v3→v4→v5 upgrades, extend the accepted `schemaVersion` union to include `6`, add `position: z.number().optional()` and tighten the card `color` field to the hex regex
- [X] T014 [P] Write failing tests in `apps/web/src/features/sync/lwwMerge.test.ts`: two devices moving different cards keep both moves with every card present exactly once, two devices moving the same card resolve to the newer `updatedAt` with ties going to local, duplicate positions after a merge still produce a stable `(position, id)` order, and the merged snapshot keeps its `sort by id` byte order
- [X] T015 Carry `position` through the snapshot writer in `apps/web/src/lib/sync/snapshot.ts` and through `apps/web/src/features/sync/lwwMerge.ts` types so a merged card round-trips its rank, writing `schemaVersion: 6`
- [X] T016 Run the foundation gate: `pnpm lint && pnpm typecheck && pnpm test` — all green before any user story phase begins

---

## Phase 3: User Story 1 — Put the cards in my own order (Priority: P1)

**Goal**: the user can press and hold a pill, drag it to any position, and the order sticks across reloads and devices

**Independent test**: reorder the pills in the header, reload the app, and the row keeps the chosen order — no colour work involved

### Tests for US1

- [X] T017 [P] [US1] Write failing tests in `apps/web/src/features/cards/SortableCardChip.test.tsx`: a press that never crosses the activation constraint still fires `onClick`, the click that ends a drag is suppressed, the dragged chip carries the lift styling while `isDragging` and loses it after drop, and `prefers-reduced-motion` disables the sortable transition
- [X] T018 [P] [US1] Write failing tests in `apps/web/src/features/cards/useCards.test.tsx` for `useReorderCardsMutation`: it patches the cached list optimistically, persists through `reorderCard`, enqueues exactly one `pushDataJson` op, rolls the cache back and toasts on failure, and — the regression that matters — does **not** enqueue `bulkUpdateCardEvents`
- [X] T019 [US1] Extend `apps/web/src/features/cards/CardsHeader.test.tsx` with failing reorder tests: a keyboard pick-up / move / drop reorders the row, Escape cancels it leaving the original order and writing nothing, a drag that ends outside the row also cancels, the existing tap-to-activate and `cards-header-first-chip` expectations still hold, and the drag announcements are read from i18n rather than hardcoded

### Implementation for US1

- [X] T020 [US1] Create `apps/web/src/features/cards/SortableCardChip.tsx`: a `useSortable` wrapper around `CardChip` that forwards the sortable attributes, listeners and transform, guards the post-drag click with a ref, drops the transition under `prefers-reduced-motion`, and preserves the forwarded `data-testid`
- [X] T021 [US1] Add the three visible feedback states from [contracts/card-ordering.md](./contracts/card-ordering.md) (FR-014): raised shadow plus slight scale on the lifted chip, neighbours shifting to open the target slot as the pointer moves, and the lift styling cleared on commit — implemented as Tailwind classes on `CardChip` driven by a `isDragging` prop so `CardChip` stays presentational
- [X] T022 [US1] Wire `DndContext` + `SortableContext` with `horizontalListSortingStrategy` into `apps/web/src/features/cards/CardsHeader.tsx`, using the sensor recipe from `apps/web/src/features/calendar/useEntryDrag.ts` verbatim (`MouseSensor { distance: 8 }`, `TouchSensor { delay: 220, tolerance: 8 }`, `KeyboardSensor`), keeping the row as the auto-scroll container and leaving the coarse-pointer ContextMenu suppression untouched
- [X] T023 [US1] Add `useReorderCardsMutation` to `apps/web/src/features/cards/useCards.ts`, switch `useCardsQuery` to `getCardsOrdered(db)`, and make sure the position-only update path bypasses `enqueueBulkUpdateCardEvents`
- [X] T024 [US1] Add the drag announcement and instruction strings to `apps/web/src/locales/{en,uk,es}.json` under a `cards.reorder.*` block (pick up, moved to position, dropped, cancelled, keyboard instructions) and pass them to dnd-kit's `announcements` / `screenReaderInstructions`
- [X] T025 [US1] Add `apps/web/e2e/11-card-reorder.spec.ts` covering both Playwright projects: drag a pill to a new index and reload to prove persistence, tap a pill and assert it activates without reordering, **swipe the row horizontally on the `mobile-iphone-13` project and assert the row scrolled and the order is unchanged** (SC-005), drive the keyboard path, and run the axe check on the reordered header
- [X] T026 [US1] Re-run the shared drag surfaces after the dnd-kit addition — `apps/web/e2e/08-drag-reschedule.spec.ts` plus the calendar drag unit tests — to prove the new dependency did not disturb the pinned behaviour

---

## Phase 4: User Story 2 — Choose a colour beyond the current twelve (Priority: P2)

**Goal**: the twelve presets stay, and the user can also pick any colour herself, with the label staying readable and Calendar events keeping a sensible colour

**Independent test**: edit a card, pick a colour that was not selectable before, and see it on the pill, in the calendar entries and in the reports

### Tests for US2

- [X] T027 [P] [US2] Write failing tests in `apps/web/src/features/cards/cardSchema.test.ts`: any `#RRGGBB` is accepted and normalised to uppercase, a malformed colour fails with `cards.validation.colorInvalid`, `buildCardInputSchema(previousColor)` keeps accepting a legacy hex, and two cards may hold the same colour without any validation error (ux.md CHK021)
- [X] T028 [P] [US2] Write failing tests in `apps/web/src/features/cards/ColorPicker.test.tsx`: the twelve presets render in contract order, a non-preset current colour renders as the leading selected swatch with the hex field pre-filled (FR-009b), the custom control accepts a typed hex and a native colour input change, both custom controls meet the 44px minimum target, the contrast warning appears only below 4.5:1, and saving is never blocked by that warning
- [X] T029 [P] [US2] Write failing tests in `apps/web/src/features/calendar-sync/buildEvent.test.ts`: each preset still produces its exact current `colorId`, a custom colour produces the nearest Google colour rather than `'8'`, a card still carrying the retired `#0284C7` produces `'7'`, and a malformed colour still falls back to `'8'`

### Implementation for US2

- [X] T030 [US2] Relax the colour rule in `apps/web/src/features/cards/cardSchema.ts` to the shared hex regex with uppercase normalisation, keeping the `previousColor` parameter and its error keys
- [X] T031 [US2] Rework `apps/web/src/features/cards/ColorPicker.tsx`: generalise the legacy swatch into a current-colour swatch, add a custom swatch that opens a native `<input type="color">` plus a hex text field pre-filled with the current colour, both at a 44px minimum target, and render the inline contrast advisory from `getLabelContrast`
- [X] T032 [US2] Replace the `GOOGLE_CALENDAR_COLOR_MAP[card.color] ?? '8'` lookup in `apps/web/src/features/calendar-sync/buildEvent.ts` with `resolveCalendarColorId(card.color)` and update the doc comment that describes the mapping
- [X] T033 [US2] Add the custom-colour and contrast-warning strings to `apps/web/src/locales/{en,uk,es}.json` under `cards.color*`, then run `pnpm i18n:check`
- [X] T034 [US2] Extend `apps/web/e2e/07-card-modal.spec.ts` with a custom-colour journey: pick a custom colour, save, and assert the pill background and label colour, then reopen the card and assert the custom colour is still the selected swatch

---

## Phase 5: User Story 3 — One order everywhere cards are listed (Priority: P3)

**Goal**: every surface that lists cards uses the order the user set. Those surfaces are the card header, the report filters (which can also show archived cards), the day entry picker, and the archived list in Settings — there is no separate active-card management screen

**Independent test**: set an order in the header, then open the report filters and the day entry picker and see the same order

### Tests for US3

- [X] T035 [P] [US3] Write failing tests in the reports data spec (`apps/web/src/features/reports/useReportData.test.ts`, or the nearest existing reports spec) asserting the card list follows `(position, id)` **both with `showArchived` off and on** — the archived-inclusive path must keep working, not silently lose archived cards
- [X] T036 [P] [US3] Write failing tests in `apps/web/src/features/cards/ArchivedCardsList.test.tsx` (create if absent): archived cards list in `(position, id)` order and a restore places the card at the end of the active row

### Implementation for US3

- [X] T037 [US3] Route `apps/web/src/features/reports/useReportData.ts` from `getAllCards(db, showArchived)` to `getCardsOrdered(db, showArchived)`, passing the flag through unchanged
- [X] T038 [P] [US3] Route `apps/web/src/features/entries/DayPickerModal.tsx` through `getCardsOrdered`
- [X] T039 [P] [US3] Route `apps/web/src/features/onboarding/OnboardingProvider.tsx` and `apps/web/src/pages/DayPage.tsx` through `getCardsOrdered`
- [X] T040 [US3] Switch `apps/web/src/features/cards/ArchivedCardsList.tsx` to `getArchivedCardsOrdered` and confirm the restore path uses `nextCardPosition(db)`
- [X] T041 [US3] Grep for remaining `getAllCards` / `getArchivedCards` callers and confirm each one is a non-display caller (snapshot writing, integrity checks); document that split in a comment on the query layer

---

## Phase 6: Polish, Release & Cross-Cutting Concerns

- [X] T042 Rewrite the palette contract in `docs/PROJECT_PLAN.md` §7.5: the twelve presets are a stable ordered contract, the colour field is an open hex, and the sky-blue correction plus the label-rule change are recorded with their reason
- [X] T043 Bump `apps/web/package.json` from `1.6.0` to `1.7.0` (minor — new feature) and restart the dev server so the `__APP_VERSION__` define is re-baked
- [X] T044 Add `{ version: '1.7.0', date: '<ship date>', i18nKey: 'v1_7_0' }` as the newest entry in `apps/web/src/features/whats-new/changelog.ts`, plus `whatsNew.releases.v1_7_0.{title,items}` first in the `releases` block of `apps/web/src/locales/{en,uk,es}.json` — user-visible wording only: reordering cards by holding and dragging, choosing your own colour, and clearer card names on light colours
- [X] T045 Run the feature's own suites per [quickstart.md](./quickstart.md), then the full gate `pnpm lint && pnpm typecheck && pnpm test`, `pnpm i18n:check` and `pnpm e2e`
- [X] T046 Walk the manual checklist in [quickstart.md](./quickstart.md) on a phone-sized viewport, measuring the pill background and label pixels rather than eyeballing them, and confirm no Calendar PATCH fires on a reorder — measurements recorded in [qa-t046.md](./qa-t046.md); the live-finger gesture added to `docs/SMOKE_TEST.md` §12

---

## Dependencies

```text
Phase 1 (T001-T002)
   └─> Phase 2 Foundational (T003-T016)   ← blocks every story
          ├─> Phase 3  US1  (T017-T026)   ← MVP
          ├─> Phase 4  US2  (T027-T034)   independent of US1
          └─> Phase 5  US3  (T035-T041)   independent of US2; natural companion to US1
                 └─> Phase 6 Release (T042-T046)
```

Within the foundation: T003/T004 → T005 (T006 hangs off T005 but blocks nothing); T007 → T008 → T009; T010 → T011; T012 → T013; T014 → T015; T016 gates the whole phase.

Within US1: T017/T018 in parallel, then T020 → T021 → T022 → T023; T019 needs T022 to exist to pass.

## Parallel opportunities

- **Foundation**: T003, T004, T007, T008, T010, T012, T014 are all different files and can be written together; their implementation tasks then follow in the order above.
- **US1**: T017 and T018 in parallel; T020–T023 are sequential (same wiring), T024 is independent.
- **US2**: T027, T028, T029 in parallel, then T030–T032 in parallel (three different files).
- **US3**: T035/T036 in parallel; T038 and T039 in parallel after T037 lands the shared query use.

## Implementation strategy

**MVP** = Phase 1 + Phase 2 + Phase 3 (US1). That alone answers the first thing the user asked for — she can order her cards herself — and is releasable.

**Increment 2** = Phase 5 (US3), tiny once the ordered query exists, and it removes the inconsistency of two different orders on two screens.

**Increment 3** = Phase 4 (US2), the colour work, which carries the deliberate visible change to existing pills and therefore benefits from shipping on its own so the change is easy to attribute.

Phase 6 runs once, with whatever increments are shipping.
