# Implementation Plan: Adjust a month's expected amount

**Spec**: `specs/011-month-expected-override/spec.md` · **Branch**: `feature/month-expected-override`

## Design

**Data — new entity `MonthAdjustment`** (`src/shared/types/monthAdjustment.ts`):
`{ id, cardId, period: 'YYYY-MM', amount: number (≥ 0), createdAt, updatedAt }`.
- `id` is deterministic: `` `${cardId}:${period}` `` (`monthAdjustmentId()`), so «at most one per
  client+month» holds by construction and two devices adjusting the same month resolve by the
  existing `updatedAt` LWW instead of producing duplicates.
- Reset = delete + tombstone (`entityType: 'monthAdjustment'`), same as payments. Setting it again
  later writes a newer `updatedAt` than the tombstone's `deletedAt`, so the merge keeps it.
- A field on `Card` was rejected: a card edit on one device would LWW-clobber an adjustment made on
  another, and the card row would grow without bound.

**Storage & sync** (pattern of S27 payments / S28 reminders):
- Dexie v10: store `monthAdjustments: 'id, cardId, period, updatedAt'`; additive, no migration.
- Repo `src/lib/db/repos/monthAdjustments.ts`: `getAllMonthAdjustments`,
  `listMonthAdjustmentsByPeriod`, `listMonthAdjustmentsInPeriods(from, to)`, `setMonthAdjustment`
  (upsert, keeps `createdAt`, validates amount), `deleteMonthAdjustment` (tombstone).
- `deleteCardPermanently` cascades adjustments with tombstones.
- Drive snapshot **v7**: `monthAdjustments?: MonthAdjustment[]`; `validateSnapshot` accepts 7,
  backfills `[]` for v2–v6; `buildSnapshot`, `applySnapshot` (replace + merge), `lwwMerge`, and
  the tombstone `entityType` enum all gain the new type. The version bump is required: an older
  client rebuilds the snapshot from its own Dexie and would silently drop adjustments on push —
  with v7 it refuses the file (existing `versionMismatch` path) until the PWA updates.

**Earnings — one shared rule** (`src/shared/utils/earnings.ts`):
- `calculatedMonthTotal(card, monthEntries, period)` = `monthlyEarningsForPeriod` + Σ
  `earningsForEntry` — extracted from `computeMonthLedger`, so Payments and Reports cannot drift.
- `adjustedEntryShares(card, monthEntries, amount)` → `Map<entryId, number>`: each entry's
  card-rate value `e_i` (monthly non-custom → `monthlyEarningsPerEntry`, else `earningsForEntry`),
  share = `amount × e_i / Σe` when `Σe > 0`, else `amount / n`. Shares sum to `amount` (FR-010).

**Payments page.**
- `computeMonthLedger(cards, entries, payments, period, adjustments = [])`: row gains
  `calculated` and `adjusted: boolean`; `expected` = adjustment amount when present. Rows still
  come from entries ∪ payments (an adjustment alone does not create a row — spec edge case).
- `useMonthLedger` adds a live read of the period's adjustments.
- `PaymentRow`: the expected amount becomes a button opening `ExpectedAmountDialog`; adjusted rows
  render «€200 · calc. €250» (`payments.row.calculated`). Status, overdue, Mark-paid prefill and
  totals already derive from `row.expected` — no further change.
- `ExpectedAmountDialog` (bottom sheet, react-hook-form + zod `expectedAmountSchema`: number,
  `0 ≤ x ≤ 1_000_000`, ≤ 2 decimals): Save → `useSetMonthAdjustmentMutation`; «Reset to
  calculated» shown only when adjusted → `useDeleteMonthAdjustmentMutation`. On failure: toast
  `payments.saveFailed`, sheet stays open. Both mutations enqueue `pushDataJson`.

**Reports.**
- `computeReport(..., adjustments = [])`: for a card+month with an adjustment, every entry of that
  month (from the month-wide scope already used for monthly cards) gets its share from
  `adjustedEntryShares`; `byEntry` and `byCard` use those shares. `monthlyContribution` counts
  only unadjusted retainer shares plus adjusted shares of monthly non-custom entries.
- `useReportData`: reads `listMonthAdjustmentsInPeriods(startMonth, endMonth)` in the same live
  read; widens the entries scope to full months when there is a monthly card **or** any adjustment
  in range (so shares use the whole month).

**i18n / release.** Keys `payments.row.calculated`, `payments.expected.*`,
`payments.validation.expected*` in uk/en/es; minor bump 1.9.0 → 1.10.0 + «What's new» `v1_10_0`.

**«Features» guide (US5, FR-013).** Port of my-diary's pattern: `GUIDE_SECTIONS` (key + emoji)
in `features/whats-new/guide.ts`, copy in `whatsNew.guide.<key>.{title,items}`, rendered as
collapsed `Disclosure` cards above the releases. `guide.test.ts` holds the shape (3–10 items,
≤220 chars, equal counts per locale, no orphan copy). Shipped in the same 1.10.0 release.

## Out of scope (FR-010a)

Calendar chips, day page, entry editor, Google Calendar event text and the cleaning's «Paid»
prefill keep card-rate amounts.

## Risks

- Snapshot v7 makes not-yet-updated devices fail sync until reload — same accepted cost as v4–v6.
- Reports widening now also triggers on adjustments; cost is one extra index read per report.
- Float shares: shares are raw floats; Reports totals round at display, Payments rounds at the
  ledger (SC-002a compares to the cent).

## Verification

`pnpm lint && pnpm typecheck && pnpm test`. Manual quickstart on `localhost:5173`: €250 monthly
client with cleanings in October → record €200 → row «Partial» → tap €250 → set 200 → «Paid»,
«€200 · calc. €250», totals drop by €50 → September unchanged → Reports October shows €200 for the
client → Reset → back to €250/«Partial».
