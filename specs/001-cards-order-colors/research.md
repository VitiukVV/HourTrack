# Phase 0 Research: Cards — user-defined order + richer colour choice

**Feature**: [spec.md](./spec.md) | **Date**: 2026-09-10

All findings below come from reading the current code, not from assumption. File and line
references are to the state of `main` at the time of writing.

## Baseline: what the code does today

| Area | Current state |
| --- | --- |
| Card list order | `apps/web/src/lib/db/queries.ts:147` — `db.cards.filter((c) => !c.isArchived).toArray()`. No ordering clause, so rows arrive in IndexedDB primary-key order, i.e. sorted by the `id` uuid v4 string. **The order the user sees today is effectively random.** |
| Card colour | `Card.color` is a hex constrained to the 12 values in `apps/web/src/lib/colors.ts` (`CARD_COLORS`). `buildCardInputSchema(previousColor)` in `features/cards/cardSchema.ts` adds one escape hatch: the card's own pre-existing hex stays valid, which is how pre-S19 "legacy" colours survive an edit. |
| Colour picker | `features/cards/ColorPicker.tsx` — 12 swatches, 44px touch targets, plus an existing "legacy" 13th swatch shown when `value` is not in `CARD_COLORS`. |
| Label colour | `getReadableTextColor()` in `lib/colors.ts` already picks `#FFFFFF` or `#0F172A` per background, and `CardChip.tsx` already applies it. It uses a relative-luminance threshold (`Y > 0.5 → dark`), explicitly documented as "not WCAG-grade". |
| Calendar colour | `features/calendar-sync/buildEvent.ts:151` — `GOOGLE_CALENDAR_COLOR_MAP[card.color] ?? '8'`. Unknown hex silently becomes Graphite grey. |
| Colour change propagation | `features/cards/useCards.ts` enqueues `bulkUpdateCardEvents` whenever `name` or `color` changes, so already-synced Calendar events follow. Other field changes deliberately skip it. |
| Dexie | `lib/db/schema.ts` is at `version(8)`, each version with an `.upgrade()` callback. |
| Drive snapshot | `features/backup/validateSnapshot.ts` accepts `schemaVersion` 2–5 and upgrades in-band (v2→v3→v4→v5) before the zod parse. |
| Merge | `features/sync/lwwMerge.ts` — per-row LWW on `updatedAt` (ties go to local), tombstones win when `deletedAt > updatedAt`, and the merged snapshot writes `cards.sort(by id)` for a deterministic file. |
| dnd-kit | `@dnd-kit/core@6.3.1` + `@dnd-kit/utilities@3.2.2`, both **exact-pinned on purpose** (`docs/DEPENDENCY_POLICY.md`). `features/calendar/useEntryDrag.ts:86-89` documents a load-bearing sensor recipe. `@dnd-kit/sortable` is not installed. |
| Long-press on a chip | Already free on touch: `CardsHeader.tsx` suppresses the native `contextmenu` on coarse pointers and renders no ContextMenu wrapper there, because long-press-to-open-menu surprised the user while drag-scrolling. |

## D1 — How the order is stored

**Decision**: a single new `position: number` field on `Card`, holding a **fractional rank**.
Moving a card writes the midpoint between its new neighbours, so **one move touches exactly
one row**. Display order is `(position, id)` — `id` as tie-break makes the order total even
if two rows collide on a position.

**Rationale**: the sync model is per-row LWW. With dense integer indices, moving one card
rewrites every row after it, so two devices reordering different cards produce a merge where
several rows have conflicting indices and the result is unpredictable. With a fractional
rank, each device's move is a single-row edit; LWW then resolves the *cards that actually
moved* and everything else keeps its rank. Duplicate ranks after a merge are harmless
because `id` breaks the tie deterministically.

**Alternatives considered**:

- *Dense integer index* — simplest to read, worst under LWW (write amplification across all
  cards, ambiguous merges). Rejected.
- *Order array in Settings* — one row to merge, but the array and the card set can drift
  (a card in the array that no longer exists, a card missing from it), and every reorder
  writes the settings row that also carries unrelated preferences. Rejected.
- *LexoRank strings* — same single-row property as fractional numbers without float
  precision limits, but needs a rank-generation library or hand-rolled base-62 arithmetic.
  Rejected as unjustified complexity for a handful of cards.

**Spacing and renormalisation**: seed positions as `index * 1024`. A midpoint insert halves
the gap; after ~50 successive inserts into the same gap the float precision would matter, so
when a computed gap falls below `1e-3` the reorder handler renormalises all active cards to
`index * 1024` in one transaction. For a personal app with a handful of cards this branch is
effectively unreachable, but it is cheap to implement and test.

## D2 — Migration and the "upgrade is a no-op" requirement

**Decision**: Dexie `version(9)` with an `.upgrade()` that reads all cards, sorts them by
`id` ascending — reproducing exactly what `toArray()` returns today — and writes
`position = index * 1024`. Drive snapshot goes to `schemaVersion: 6` with the same backfill
applied in-band by a new `upgradeV5ToV6` in `validateSnapshot.ts`, following the existing
v2→v3→v4→v5 chain.

**Rationale**: FR-008 wants the first order after the upgrade to match what the user saw
before. Since today's order *is* the `id` sort, sorting by `id` at migration time makes the
upgrade invisible. No heuristic, no guessing.

**Forward compatibility** (gap CHK029): the snapshot's zod schema must treat `position` as
optional-with-default on read, so a snapshot written by the older version (no `position`)
still validates and gets backfilled. The reverse — an older app reading a v6 snapshot — is
already handled by the existing version gate: it refuses an unknown `schemaVersion` with a
clear message rather than corrupting data. That behaviour is inherited, not new.

**Rollback** (gap CHK030): Dexie upgrades run in a transaction, so a failed `version(9)`
upgrade leaves the v8 data intact and the app reports the existing DB-open failure path. No
new rollback machinery.

## D3 — Reorder interaction

**Decision**: `@dnd-kit/sortable@10.0.0` (exact-pinned, peers `@dnd-kit/core@^6.3.0`, so it
pairs with the pinned 6.3.1) with `horizontalListSortingStrategy`, reusing the sensor recipe
already proven in this codebase:

```
MouseSensor    activationConstraint: { distance: 8 }
TouchSensor    activationConstraint: { delay: 220, tolerance: 8 }
KeyboardSensor default coordinate getter
```

**Rationale**: `useEntryDrag.ts:58-70` documents why this exact combination is load-bearing —
`PointerSensor` races `TouchSensor` for the same finger, and the 220ms/8px touch constraint
is what lets a swipe still scroll while a hold starts a drag. The cards row has the same
requirement (FR-004), so it gets the same recipe rather than a second, divergent one. The
220ms hold also answers the deferred "how long is the hold" question (CHK001) with the value
already tuned for this app instead of a fresh guess.

**Why a new dependency**: reordering with `@dnd-kit/core` alone means hand-writing droppable
slots, index maths and the reorder animation. `DEPENDENCY_POLICY.md` warns that DnD touch
behaviour is exactly where this project has been bitten, which argues for the official
sortable package over bespoke pointer code. It must be exact-pinned like its siblings and
added to the policy's pinned list, and it is dev-visible only through the cards row.

**Gesture separation** (FR-004, CHK002): the 8px tolerance cancels an accidental drag, and
`CardChip`'s `onClick` must be suppressed when a drag actually occurred — dnd-kit exposes
`isDragging`, and the click handler checks a "did we just drag" ref that the drag-end handler
sets. Tap-to-activate is covered by existing tests in `CardsHeader.test.tsx`, which must stay
green untouched.

**Keyboard path** (FR-015, CHK010): `KeyboardSensor` gives pick-up / move / drop on the chip
itself — space to lift, arrows to move, space to drop, escape to cancel. No separate reorder
screen is needed. dnd-kit's `announcements` + `screenReaderInstructions` provide the
assistive-technology output (CHK011); the calendar drag already sets these, so the wording
follows that precedent and gets its own i18n keys in all three locales.

**Reduced motion** (CHK013): `prefers-reduced-motion` disables the sortable transition (pass
`transition: null` when the media query matches) so the card jumps to its slot instead of
animating.

**Auto-scroll while dragging** (CHK007): dnd-kit's `autoScroll` handles the scrolling
container out of the box; it needs the scroll container to be the row itself, which it
already is.

**Single card** (CHK009): with one card the sortable list still renders; a drag that cannot
change anything simply drops back. No special case.

## D4 — Custom colour

**Decision**: keep `CARD_COLORS` as the preset row, and let `Card.color` hold any
`#RRGGBB`. `ColorPicker` grows a "custom" swatch that opens a native `<input type="color">`
plus a hex text field; the existing legacy-swatch pathway is generalised into "the card's
current colour, whatever it is" (FR-009b, CHK019 — no global recent-colours list in this
release, deliberately).

**Rationale**: the user asked for "more colours **or** let me pick" and chose both. Presets
keep the two-tap pick (SC-006) and stay the recommended path; the picker removes the ceiling.
Generalising the legacy swatch means one code path instead of two, and FR-013 (legacy colours
keep working) falls out for free.

**Validation**: `buildCardInputSchema` drops the palette-membership refine in favour of a
`/^#[0-9A-Fa-f]{6}$/` check, normalised to uppercase. `assertCardShape` in
`lib/db/queries.ts` must be relaxed the same way, and `validateSnapshot`'s card schema
already accepts `z.string()` for colour, so a corrupt value is caught by the same regex at
the write boundary (CHK036).

**Contract documentation**: `CARD_COLORS` and `docs/PROJECT_PLAN.md` §7.5 currently describe
the palette as closed. Both must be rewritten to say: the twelve presets are a stable,
ordered contract; the colour *field* is an open hex.

## D5 — Label contrast

**Decision**: `getReadableTextColor()` switches from the luminance threshold to a real
contrast-ratio comparison, and a new `getLabelContrast(bg)` returns the chosen label plus its
ratio so the picker can warn below 4.5:1. The sky-blue preset `#0284C7` is replaced by
**`#0C74B0`**, and cards holding the old value are migrated to it in the same Dexie
`version(9)` upgrade.

**Measured basis** (computed against the current palette, sRGB → linear → WCAG ratio):

| Preset | White | Dark `#0F172A` | Today's label | Ratio-based label |
| --- | --- | --- | --- | --- |
| `#DC2626` Tomato | 4.83 | 3.70 | white | white |
| `#EA580C` Orange | 3.56 | **5.02** | white | dark (flips) |
| `#D97706` Amber | 3.19 | **5.60** | white | dark (flips) |
| `#CA8A04` Banana | 2.94 | **6.08** | white | dark (flips) |
| `#65A30D` Lime | 3.09 | **5.78** | white | dark (flips) |
| `#16A34A` Basil | 3.30 | **5.42** | white | dark (flips) |
| `#0D9488` Teal | 3.74 | **4.77** | white | dark (flips) |
| `#0284C7` Sky | 4.10 | 4.36 | white | **fails either way** |
| `#2563EB` Blueberry | 5.17 | 3.45 | white | white |
| `#7C3AED` Violet | 5.70 | 3.13 | white | white |
| `#C026D3` Fuchsia | 4.71 | 3.79 | white | white |
| `#DB2777` Flamingo | 4.60 | 3.88 | white | white |

So the honest rule flips seven labels from white to dark, and one preset cannot pass with any
label. The user was shown both consequences and chose to take them, including the palette
change (FR-010a, FR-010b).

**Why `#0C74B0`** for Sky: white text reaches 5.07:1, and CIELAB ΔE from the old hex is 7.1 —
a recognisably deeper version of the same blue rather than a different colour. Compared
against alternatives: `#0369A1` (Tailwind sky-700) is safer at 5.93:1 but shifts twice as far
(ΔE 11.9); `#1E7FB8` only reaches 4.39:1 and still fails. `#0C74B0` stays far from its
neighbours in the palette (ΔE 49 to Blueberry, 48 to Teal), so the 12-way contrast the S19
palette was curated for is preserved.

**Both themes** (CHK017): the pill background is `card.color` and the label is one of two
fixed values, neither of which comes from the theme, so the ratio is theme-independent. The
requirement is satisfied by construction — worth an explicit test comment rather than two
sets of numbers.

## D6 — Nearest Google Calendar colour

**Decision**: keep `GOOGLE_CALENDAR_COLOR_MAP` as the authoritative mapping for the twelve
presets, including its three deliberate collisions. For any other hex, pick the nearest of
Google's eleven event colours by CIELAB ΔE76, computed with a small local sRGB→CIELAB helper
(no new dependency). `?? '8'` survives only as the guard for a malformed hex.

**Rationale**: the preset mapping encodes hand-made choices (Lavender and Graphite
deliberately unused) that a distance function would happily undo. Nearest-neighbour applies
only where there is no curated answer. ΔE76 is enough to pick between eleven well-separated
colours and is a dozen lines of arithmetic.

**Google's event palette** (used as the distance targets):

```
1 Lavender #7986CB   2 Sage      #33B679   3 Grape    #8E24AA   4 Flamingo #E67C73
5 Banana   #F6BF26   6 Tangerine #F4511E   7 Peacock  #039BE5   8 Graphite #616161
9 Blueberry #3F51B5  10 Basil    #0B8043   11 Tomato  #D50000
```

These are Google's documented event colours and the implementation task includes verifying
them once against `GET /calendar/v3/colors` with the app's authenticated client, so the
constant is confirmed rather than trusted from memory.

**Determinism** (CHK037): ties are broken by ascending `colorId`, so the function is a pure,
total, testable mapping from hex to `'1'..'11'`.

**Existing events** (CHK038): no new behaviour needed. `useCards.ts` already enqueues
`bulkUpdateCardEvents` when `color` changes, so events follow a custom colour and follow the
Sky correction. The plan must make sure a **position-only** change does *not* enqueue it —
otherwise every reorder would PATCH every Calendar event of the moved card for nothing.

## D7 — One order everywhere

**Decision**: add `getCardsOrdered(db, includeArchived?)` / `getArchivedCardsOrdered(db)` to
`lib/db/queries.ts` sorting by `(position, id)` — db handle first, matching the module
convention — and route every consumer through them:
`features/cards/useCards.ts`, `features/reports/useReportData.ts`,
`features/entries/DayPickerModal.tsx`, `features/onboarding/OnboardingProvider.tsx`,
`pages/DayPage.tsx`, `lib/sync/snapshot.ts`.

**Rationale**: FR-005 fails the moment one screen sorts differently. A single sorted query is
the only place the comparator lives. `getCardsOrdered` takes the same `includeArchived` flag
as the `getAllCards` it replaces, because the report filters can show archived cards — an
active-only ordered query would quietly drop them. The surfaces are the card header, the
report filters, the day entry picker and the archived list in Settings; there is no separate
active-card management screen.

**Archived cards** (CHK024): archived cards keep their `position` value, are ordered among
themselves by the same comparator, and a restore appends to the end of the *active* order by
taking `max(position) + 1024` (FR-007 and the spec assumption). A delete leaves gaps, which
is harmless under fractional ranks (CHK023).

**Sync trigger** (CHK033): a reorder writes card rows, so the existing
`enqueueCardPush('update', …)` path already marks the snapshot dirty; one push per reorder,
not one per moved card, because the snapshot is whole-file anyway.

## D8 — Scale

A personal app with a handful of cards; the row already scrolls horizontally. No performance
work is planned beyond keeping the reorder write inside one Dexie transaction (CHK025,
CHK034). Offline is inherited: writes land in Dexie first and the sync queue replays them,
exactly as for a card edit.
