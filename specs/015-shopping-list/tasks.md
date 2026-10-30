# Tasks: Shopping list per house

**Spec**: `spec.md` · **Plan**: `plan.md` · Tests first (TDD), colocated `*.test.ts(x)`.

## Phase 1: Foundational — entity, storage, sync

- [x] T001 [P] Add `ShoppingItem` type in `src/shared/types/shoppingItem.ts` (export from `src/shared/types/index.ts`); add `'shoppingItem'` to `TombstoneEntityType` in `src/shared/types/tombstone.ts`
- [x] T002 [P] Write failing tests in `src/shared/utils/shopping.test.ts` for `shoppingItemsForMonth` (needed/bought split, carry-over, bought in later month shows needed in earlier month, future month, ordering) and `SHOPPING_TEXT_MAX`/`normalizeShoppingText`; implement in `src/shared/utils/shopping.ts`, export from `src/shared/utils/index.ts`
- [x] T003 Dexie v11 with `shoppingItems: 'id, cardId, updatedAt'` (all prior stores re-declared) in `src/lib/db/schema.ts`; extend `src/lib/db/dexie.upgrade.test.ts` for v10 → v11
- [x] T004 Write failing tests in `src/lib/db/repos/shoppingItems.test.ts`; implement `src/lib/db/repos/shoppingItems.ts` (`getAllShoppingItems`, `addShoppingItem`, `updateShoppingItemText`, `setShoppingItemBought` stamping local `boughtPeriod`, `deleteShoppingItem` with tombstone); export from `src/lib/db/queries.ts`
- [x] T005 Cascade items + tombstones in `deleteCardPermanently` in `src/lib/db/repos/cards.ts` (+ test)
- [x] T006 Snapshot v8: `src/shared/types/snapshot.ts`, `src/lib/sync/snapshot.ts` (build/apply/counts), `src/lib/sync/validateSnapshot.ts` (accept 8, backfill `[]`, validate rows), `src/features/sync/lwwMerge.ts` (merge + tombstones), `src/features/backup/backupService.ts`; extend their tests (round-trip, v7 backfill, LWW per item, tombstone wins)

## Phase 2: User Story 1 + 2 — add, edit, delete, tick (P1)

**Independent test**: add «White bags» to a house, tick it, untick it, edit, delete; persists after reload.

- [x] T007 [US1] Write failing tests in `src/features/shopping/useShoppingItems.test.tsx`; implement `src/features/shopping/useShoppingItems.ts` (live read + add/update/toggle/delete mutations enqueuing `pushDataJson`, toast on failure) and `src/features/shopping/shoppingSchema.ts`
- [x] T008 [P] [US2] Write failing tests in `src/features/shopping/ShoppingItemRow.test.tsx`; implement `src/features/shopping/ShoppingItemRow.tsx` (checkbox, wrapped text, struck through when bought, inline edit, delete)
- [x] T009 [US1] Write failing tests in `src/features/shopping/ShoppingHouseBlock.test.tsx`; implement `src/features/shopping/ShoppingHouseBlock.tsx` (color + name + needed count header via `Disclosure`, collapsed when empty, add form rejecting blank)

## Phase 3: User Story 3 — month carry-over (P1)

- [x] T010 [US3] Move `currentPeriod`/`shiftPeriod` to `src/shared/utils/period.ts` only if the feature-graph test forbids the cross-feature import; write failing tests in `src/pages/shopping/ShoppingPage.test.tsx` (one block per active card in card order, archived hidden, month stepping, carry-over view, no-houses state); implement `src/pages/shopping/ShoppingPage.tsx`
- [x] T011 [US3] Route `/shopping` in `src/app/routing/routes.tsx`; `NAV_ITEMS` entry between Payments and Settings and 5-item bottom-nav fit (`px-1`, `truncate`) in `src/app/shell/AppLayout.tsx` (+ test update)

## Phase 4: User Story 4 — every device (P2)

- [x] T012 [US4] Covered by T006; add a `src/features/sync/lwwMerge.shopping.test.ts` scenario: device A ticks, device B edits text later → B's row wins; delete on B with tombstone → gone on A

## Phase 5: Release & polish

- [x] T013 i18n `nav.shopping`, `shopping.*` in `src/locales/{uk,en,es}.json`; bump `package.json` to 1.12.0; `v1_12_0` in `src/features/whats-new/changelog.ts` + all locales; guide section `{ key: 'shopping', emoji: '🛒' }` in `src/features/whats-new/guide.ts` + `whatsNew.guide.shopping` in all locales
- [x] T014 Run `pnpm lint && pnpm typecheck && pnpm test`; manual 390 px check of `/shopping` and the bottom nav at 360 px; commit

## Phase R: Review fixes (stage 4)

- [x] T015 Stamp adds/ticks with the viewed month (clamped) in src/lib/db/repos/shoppingItems.ts; pass `period` through ShoppingPage → ShoppingHouseBlock → ShoppingItemRow → hooks
- [x] T016 Hooks log + toast failures; edit keeps draft on failure, blur guard (src/features/shopping/*)
- [x] T017 Skew-tolerant month rule in src/shared/utils/shopping.ts; tests: tombstone validation, merge-mode apply, null list, 201 chars, midnight boundary, page add/tick in a past month

## Dependencies

T001 → T002 → T003 → T004 → T005/T006 → T007 → T008/T009 → T010 → T011 → T012 → T013 → T014.
MVP: Phases 1–3.

## Phase 6: Convergence

- [x] T018 Align the spec.md midnight-tick edge case with the stage-4 rule (a tick goes into the month on screen, clamped to [added month, current local month]; on the current month that is the local date) per Edge Cases / plan: review decisions (contradicts)
