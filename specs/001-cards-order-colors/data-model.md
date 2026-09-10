# Phase 1 Data Model: Cards — user-defined order + richer colour choice

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-10

## Card

Existing entity in `packages/shared-types/src/card.ts`. One field is added and one field's
constraint is relaxed; nothing is removed.

| Field | Change | Rules |
| --- | --- | --- |
| `position` | **new**, `number` | Fractional rank. Display order is `(position, id)` ascending. Finite; **may be negative** — a move to the front writes `firstPosition - 1024`, so a row that has been reordered a few times legitimately holds negative ranks. Seeded as `index * 1024`; a move writes the midpoint of its new neighbours; the last slot writes `lastPosition + 1024`. Required on every row after the v9 migration; a row that reaches Dexie without one (only possible via a write that skipped the guards) sorts last and is reported to the console. |
| `color` | constraint relaxed | Was: one of the 12 `CARD_COLORS` (plus the card's own legacy value). Now: any `#RRGGBB`, normalised to uppercase. The 12 presets remain a stable, ordered contract for the picker and for the Calendar mapping — they are no longer the set of permitted values. |

Unchanged: `id`, `name`, `defaultDurationMin`, `defaultStartMinutes`, `rateType`,
`hourlyRate`, `fixedTotal`, `monthlyTotal`, `defaultNote`, `isArchived`, `createdAt`,
`updatedAt`.

### Validation

| Layer | File | Rule after this change |
| --- | --- | --- |
| Form input | `features/cards/cardSchema.ts` | `color` matches `/^#[0-9A-Fa-f]{6}$/`; `buildCardInputSchema(previousColor)` keeps its signature but no longer needs the palette escape hatch, since any hex is now valid |
| DB write boundary | `lib/db/queries.ts` → `assertCardShape` | Same hex regex; `position` must be a finite number |
| Snapshot read | `features/backup/validateSnapshot.ts` | `color: z.string()` tightened to the same hex regex; `position: z.number().optional()` so a v5 snapshot still parses and is backfilled |

### Ordering rules

- **New card** — `position = max(position over all cards) + 1024`, so it lands at the end
  (FR-006).
- **Restored from archive** — same rule as a new card, computed over *active* cards, so a
  restore appends to the end of the visible row (FR-007).
- **Archived card** — keeps whatever `position` it had; archived lists sort by the same
  comparator (spec assumption).
- **Deleted card** — leaves a gap in the rank space; harmless, no renormalisation needed.
- **Renormalisation** — when a computed midpoint gap would fall below `1e-3`, rewrite all
  active cards as `index * 1024` inside the same transaction as the move.
- **Reorder write** — one Dexie transaction; each affected card's `updatedAt` is bumped so
  LWW sees the change. A move touches exactly one card in the normal case.

## Migrations

### Dexie: `version(8)` → `version(9)`

Runs in one transaction (`lib/db/schema.ts`, following the shape of versions 2–8):

1. Read all cards.
2. Sort by `id` ascending — this reproduces exactly the order `db.cards…toArray()` returns
   today, which is what the user currently sees (FR-008).
3. Write `position = index * 1024` on every card.
4. Rewrite `color` from `#0284C7` to `#0C74B0` on any card holding the old sky blue
   (FR-010a). No other colour value is touched.

`position` is **not** added to the Dexie index list — every query loads the full card set and
sorts in memory, and an index on a mutable float buys nothing at this scale.

### Drive snapshot: `schemaVersion: 5` → `6`

`features/backup/validateSnapshot.ts` gains `upgradeV5ToV6`, chained after the existing
v2→v3→v4→v5 upgrades and applied **before** the zod parse:

1. Backfill `position = index * 1024` over `cards` sorted by `id`, for any card missing it.
2. Rewrite `#0284C7` → `#0C74B0`.
3. Set `schemaVersion: 6`.

The accepted-version union becomes `2 | 3 | 4 | 5 | 6`. A snapshot from a *newer* unknown
version keeps hitting the existing pre-check and is refused with the existing message, so an
older app build cannot corrupt a v6 file.

### LWW merge

`features/sync/lwwMerge.ts` needs no new strategy: `position` travels inside the card row and
is resolved by the existing per-row `updatedAt` comparison. Two consequences to make explicit
in tests:

- Two devices moving **different** cards merge cleanly — each moved row wins on its own
  `updatedAt`, unmoved rows keep their rank.
- Two devices moving the **same** card resolve to the newer `updatedAt`; ties go to local,
  which is the existing convention.
- Duplicate `position` values after a merge are legal and produce a stable order because the
  comparator falls back to `id`. No card is lost or duplicated, because the merge still keys
  on `id` (FR-003).
- The merged snapshot keeps writing `cards.sort(by id)` — that is the file's canonical byte
  order and is independent of display order.

## Colour model

| Concept | Where | Definition |
| --- | --- | --- |
| `CARD_COLORS` | `lib/colors.ts` | The twelve presets, order preserved, `#0284C7` replaced by `#0C74B0`. Still a documented contract: the values and their order are stable, and the picker renders them in that order. |
| Label colour | `lib/colors.ts` → `getReadableTextColor(bg)` | Returns `#FFFFFF` or `#0F172A`, whichever has the higher WCAG contrast ratio against `bg`. Replaces the luminance-threshold rule. Malformed hex still returns `#0F172A`. |
| Contrast report | `lib/colors.ts` → `getLabelContrast(bg)` (new) | `{ color, ratio }` for the chosen label, so the picker can warn when `ratio < 4.5` (FR-009c). |
| Calendar colour | `lib/colors.ts` → `resolveCalendarColorId(hex)` (new) | Exact lookup in `GOOGLE_CALENDAR_COLOR_MAP` for the twelve presets (collisions preserved); otherwise the nearest of Google's eleven event colours by CIELAB ΔE76, ties broken by ascending `colorId`; `'8'` only for a malformed hex. |
| `GOOGLE_CALENDAR_COLOR_MAP` | `lib/colors.ts` | Unchanged in structure; the Sky key becomes `#0C74B0` and keeps mapping to `'7'` (Peacock). |

## Test-visible invariants

These are the properties the implementation must be able to prove, and they map directly onto
the success criteria:

1. Every card has a finite `position` after a v8→v9 upgrade, and the resulting order equals
   the pre-upgrade `id` order (SC-003, FR-008).
2. A card moved to position *n* is at index *n* after a reload (SC-001, FR-002).
3. Merging two snapshots where each device moved a different card yields both moves, with
   every card present exactly once (SC-002, FR-003).
4. `getReadableTextColor` returns a label reaching ≥ 4.5:1 for all twelve presets (SC-004).
5. `resolveCalendarColorId` returns the documented `colorId` for each of the twelve presets,
   and a value in `'1'..'11'` for any other hex — never `'8'` by accident (FR-012).
6. A position-only card update does not enqueue `bulkUpdateCardEvents` (guards against a
   Calendar PATCH storm on every reorder).
7. Tapping a chip still activates it and a horizontal swipe still scrolls the row (SC-005,
   FR-004) — the existing `CardsHeader.test.tsx` expectations stay green unchanged.
