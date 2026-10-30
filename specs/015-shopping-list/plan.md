# Implementation Plan: Shopping list per house

**Spec**: `specs/015-shopping-list/spec.md` · **Branch**: `feature/shopping-list-and-sync-fix`

## Design

**Data — new entity `ShoppingItem`** (`src/shared/types/shoppingItem.ts`):
`{ id (uuid), cardId, text (1–200 after trim), addedPeriod: 'YYYY-MM', boughtAt: ISO | null,
boughtPeriod: 'YYYY-MM' | null, createdAt, updatedAt }`.
- Periods are stamped from the device's **local** date at write time (spec edge case), so month
  membership never depends on time zones at read time. `boughtAt`/`boughtPeriod` are set and
  cleared together.
- **Month rule** (FR-005), pure helper `shoppingItemsForMonth(items, period)` in
  `src/shared/utils/shopping.ts`: an item belongs to month M iff `addedPeriod ≤ M` and
  (`boughtPeriod === null` or `boughtPeriod ≥ M`); it renders as bought iff `boughtPeriod === M`.
  This gives carry-over (US3), history when stepping back (bought in N > M ⇒ still needed in M),
  and future months show only needed items. Order: needed by `createdAt` asc, then bought by
  `boughtAt` desc.
- One row per item rather than a per-card list document: per-item LWW means ticking on one device
  and adding on another never clobber each other (CHK009).

**Storage & sync** (pattern of spec 011 `monthAdjustments`):
- Dexie v11: store `shoppingItems: 'id, cardId, updatedAt'`; additive. The whole table is read and
  filtered in memory (a household list is tens of rows).
- Repo `src/lib/db/repos/shoppingItems.ts`: `getAllShoppingItems`, `addShoppingItem(cardId, text)`,
  `updateShoppingItemText`, `setShoppingItemBought(id, bought)`, `deleteShoppingItem` (tombstone
  `entityType: 'shoppingItem'`). Validation in the repo throws on empty/oversized text.
- `deleteCardPermanently` cascades items with tombstones. Archiving does nothing to them; the page
  hides archived cards, so they reappear on restore (spec edge case).
- Drive snapshot **v8**: `shoppingItems?: ShoppingItem[]`; `validateSnapshot` accepts 8 and
  backfills `[]` for v2–v7; `buildSnapshot`, `applySnapshot`, `lwwMerge`, tombstone enum,
  `backupService` version string all gain it. Older clients refuse v8 via the existing
  `versionMismatch` path rather than dropping items (spec edge case).

**Feature** `src/features/shopping/`:
- `useShoppingItems()` — live read of all items (`useLiveRead` pattern); mutations
  `useAddShoppingItem`, `useUpdateShoppingItemText`, `useToggleShoppingItemBought`,
  `useDeleteShoppingItem` — each enqueues `pushDataJson`; failure → toast `shopping.saveFailed`.
- `shoppingSchema.ts` — zod `text: trim, 1..200`.
- `ShoppingHouseBlock` — card color dot + name + needed count header, reusing `Disclosure`
  (`defaultOpen` when the block has items for the month); body: item rows + inline add form
  (input + «Add» button, Enter submits).
- `ShoppingItemRow` — checkbox (bought), text (`break-words`, struck through when bought), edit
  (inline input, Enter/blur saves, Esc cancels), delete (icon button, no confirm — one tap to
  undo isn't needed for a one-line note; delete is permanent but cheap to re-add).
- Month stepper: reuse `currentPeriod` / `shiftPeriod` from `features/payments/paymentsStore.ts`
  (move them to `src/shared/utils/period.ts` if the feature-graph lint forbids the cross-feature
  import); month held in page state, defaults to current month (FR-006).

**Page & nav**: `src/pages/shopping/ShoppingPage.tsx`, route `/shopping` (lazy, like `payments`),
`NAV_ITEMS` gets `{ to: '/shopping', labelKey: 'nav.shopping' }` between Payments and Settings.
Five bottom-nav items at 360 px: tighten item padding to `px-1` and let labels `truncate` so
«Налаштування» fits (SC-004). Empty state when no active cards: `shopping.noHouses`.

**i18n / release**: `nav.shopping`, `shopping.*` in uk/en/es; minor 1.11.1 → 1.12.0, «What's new»
`v1_12_0`; new guide section `{ key: 'shopping', emoji: '🛒' }` with 3–5 items.

## Rejected

- Storing a month snapshot of lists (copying unbought items on the 1st): needs a scheduler,
  duplicates rows, and conflicts across devices. The derived month rule needs no job.
- A field on `Card` holding the list: card-level LWW would lose concurrent edits.

## Risks

- Snapshot v8: not-yet-updated devices fail sync until reload — same accepted cost as v4–v7.
- Bottom nav with 5 labels is tight at 360 px; covered by an e2e/visual check on `mobile-iphone-13`
  and a manual 360 px check.

## Verification

`pnpm lint && pnpm typecheck && pnpm test`. Unit: month rule table (added/bought across months,
untick, future month, order), repo validation + tombstone, snapshot v8 round-trip + v7 backfill,
LWW merge of items, card-delete cascade. Component: add/edit/tick/delete, collapsed empty block,
no-houses state, month stepping. Manual quickstart on `localhost:5173` at 390 px: add «Bags» +
«Soap» to a house, tick «Soap», step to next month → only «Bags»; step back → «Soap» struck through.
