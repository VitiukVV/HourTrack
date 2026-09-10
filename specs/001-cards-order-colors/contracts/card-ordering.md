# Contract: Card ordering

**Feature**: [../spec.md](../spec.md) | **Data model**: [../data-model.md](../data-model.md)

This app exposes no HTTP API. Its contracts are the module boundaries other code depends on,
plus the on-disk shapes. Both are listed here so a change to either is a deliberate act.

## Query layer — `apps/web/src/lib/db/queries.ts`

Every function in this module takes the db handle as its first parameter — the established
convention (`getAllCards(db, includeArchived = false)`, `getArchivedCards(db)`). The new
functions follow it rather than introducing a second style.

```ts
/**
 * Cards in the user's chosen order: (position, id) ascending.
 * `includeArchived` mirrors `getAllCards` — the report filters can show
 * archived cards, and they must be ordered by the same rule.
 */
export function getCardsOrdered(
  db: HourTrackDB,
  includeArchived?: boolean,
): Promise<Card[]>;

/** Archived cards only, same comparator. */
export function getArchivedCardsOrdered(db: HourTrackDB): Promise<Card[]>;

/**
 * Move `cardId` so it sits at `toIndex` among the currently active cards.
 * Writes the midpoint rank of the new neighbours, bumps `updatedAt`, and
 * renormalises every active card when the gap would collapse below 1e-3.
 * One Dexie transaction. Resolves to the new position.
 */
export function reorderCard(
  db: HourTrackDB,
  cardId: string,
  toIndex: number,
): Promise<number>;

/** Next rank for a card entering the active row (create, restore). */
export function nextCardPosition(db: HourTrackDB): Promise<number>;
```

Rules callers may rely on:

- `getCardsOrdered` is the **only** sanctioned way to list cards for display, and it replaces
  `getAllCards` at every display call site — including
  `features/reports/useReportData.ts`, which passes the filter's `showArchived` flag through
  unchanged. `getAllCards` / `getArchivedCards` remain for non-display callers (snapshot
  writing, integrity checks).
- `reorderCard` is idempotent for a no-op move (same index in, same rank out, no write).
- `toIndex` is clamped to `[0, activeCount - 1]`.
- Ordering never depends on `isArchived`: an archived card keeps its rank, so restoring it
  without a new rank would drop it back into the middle of the row — hence `nextCardPosition`
  on restore.

## Mutation layer — `apps/web/src/features/cards/useCards.ts`

```ts
/** Optimistic reorder: patches the cached list, then persists via reorderCard. */
export function useReorderCardsMutation(): UseMutationResult<
  number,
  Error,
  { cardId: string; toIndex: number }
>;
```

Both `useCardsQuery` and the reports query read through `getCardsOrdered`, so the cache the
mutation patches is already in display order.

- On success it enqueues exactly one `pushDataJson` sync op for the moved card.
- It MUST NOT enqueue `bulkUpdateCardEvents`. That op exists for `name`/`color` changes; a
  reorder does not change any Calendar event, and enqueueing it would PATCH every event of
  the moved card on every drag.
- On error it rolls the cached list back and surfaces a toast, matching the existing
  archive/delete mutation behaviour.

## Component contract — the card row

`CardsHeader` wraps the chip row in `DndContext` + `SortableContext`
(`horizontalListSortingStrategy`) and renders each card through a new `SortableCardChip`.

| Behaviour | Contract |
| --- | --- |
| Sensors | `MouseSensor { distance: 8 }`, `TouchSensor { delay: 220, tolerance: 8 }`, `KeyboardSensor` — identical to `features/calendar/useEntryDrag.ts`, which documents why this combination is load-bearing |
| Tap | A press that never activates a sensor still fires `toggleActive` (existing behaviour, existing tests) |
| Swipe | A horizontal swipe under 220ms scrolls the row; the row remains the dnd-kit auto-scroll container |
| Drag end | The chip's `onClick` is suppressed for the click that terminates a drag |
| Lift feedback | On activation the dragged chip is visually distinct from the row — raised with a shadow and a slight scale — so the hold is unmistakably registered (FR-014, phase 1) |
| Drop indication | The other chips shift to open the target slot as the pointer moves, which *is* the landing indicator; no separate placeholder element (FR-014, phase 2) |
| Commit feedback | On drop the chip settles into its slot and the lift styling is removed; no toast, because the row itself shows the result (FR-014, phase 3) |
| Cancel | Escape cancels a keyboard move; a pointer released outside the row, or the app being backgrounded mid-drag, drops the chip back to its original slot with no write |
| Keyboard | Space lifts, arrows move, space drops, Escape cancels — via `KeyboardSensor` on the chip itself |
| Announcements | dnd-kit `announcements` + `screenReaderInstructions`, i18n keys in `uk`/`en`/`es` |
| Reduced motion | `transition: null` when `prefers-reduced-motion` matches |
| `data-testid` | `cards-header-first-chip` is preserved (onboarding anchor); the sortable wrapper must not shadow it |

## On-disk contract — Drive snapshot

```jsonc
{
  "schemaVersion": 6,          // was 5
  "cards": [
    {
      "id": "…",
      "position": 2048,        // new: finite number, required from v6 on
      "color": "#0C74B0",      // any #RRGGBB from this version on
      // … unchanged card fields
    }
  ]
  // … entries, payments, reminders, tombstones unchanged
}
```

- Accepted `schemaVersion` values: `2 | 3 | 4 | 5 | 6`. A v5 file is upgraded in-band
  (`position` backfilled over `cards` sorted by `id`, old sky blue rewritten) before
  validation.
- An unknown higher version keeps hitting the existing pre-check and is refused with the
  existing user-facing message.
- The snapshot's array order stays `sort by id`; display order comes from `position`.
