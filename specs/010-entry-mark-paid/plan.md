# Implementation Plan: Mark paid from a cleaning's card

**Spec**: `specs/010-entry-mark-paid/spec.md` · **Branch**: `feature/entry-mark-paid`

## Design

**Data.** `Payment` gains optional `entryId?: string | null` (shared-types). No Dexie version
bump and no index: payments are a few hundred rows at most, so lookups scan the table. The Drive
`paymentSchema` already `passthrough()`s unknown keys, so older clients keep the field intact and
no snapshot version bump is needed; the schema adds `entryId: z.string().nullable().optional()`
to validate it when present.

**Reads.** One live read, `usePaymentsByEntry()` (features/payments) → `Map<entryId, Payment>`
from a new repo function `listEntryLinkedPayments(db)` (payments with a non-empty `entryId`,
sorted like the rest). Duplicates (two devices racing) resolve to the earliest `createdAt`, so the
card is stable; both still count in totals.

**Card (US1–US2).** New `features/payments/EntryPaymentControl.tsx`, rendered by `EntryEditor`
under the earnings line when the card's `rateType !== 'monthly'` and the entry is saved:
- no linked payment → «Paid» button → `MarkPaidDialog` in create mode with `remaining` = the
  editor's earnings preview (the number already shown, from saved values), `paidOn` = entry date,
  `period` = entry month, `entryId` = entry id;
- linked payment → «Paid €X» button → `MarkPaidDialog` in edit mode, which gains a «Remove
  payment» action (confirm, then `useDeletePaymentMutation`).
`MarkPaidDialog` gets two optional props: `entryId` and `defaultPaidOn`; the Payments page call
site is unchanged (FR-007). Zero earnings → prefill empty (existing `remaining > 0` rule).

**Calendar (US3).** MonthView/WeekView call `usePaymentsByEntry()` once and pass `paid={map.has(id)}`
(a primitive, keeps `memo(EntryChip)` bailouts) through DayCell / WeekAgendaView to `EntryChip`,
which renders a small check-badge icon with `aria-label={t('calendar.paid')}` in both variants.

**i18n / release.** New keys in en/uk/es (`payments.entry.*`, `calendar.paid`,
`payments.dialog.remove*`); minor bump 1.7.2 → 1.8.0 with a «What's new» entry.

## Risks

- `EntryEditor` is shared with DayPage — the control appears there too (accepted in spec).
- The chip's `memo` bailout: passing the Map instead of a boolean would re-render every chip on
  any payment write; pass the boolean.
- An entry with unsaved edits: the prefill uses saved earnings, not the dirty preview, so the
  payment matches what's stored.

## Verification

`pnpm lint && pnpm typecheck && pnpm test`; manual: quickstart below on `localhost:5173`.

**Quickstart.** Hourly client → add a cleaning → open from calendar → «Paid» → amount = shown
earnings, date = cleaning date → Confirm → toast with Undo; chip shows the paid badge; Payments
page for that month includes it; reopen → «Paid €X» → edit / remove works; monthly client → no button.
