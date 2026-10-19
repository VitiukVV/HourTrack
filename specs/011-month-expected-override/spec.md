# Feature Specification: Adjust a month's expected amount on the Payments page

**Feature Branch**: `feature/month-expected-override`

**Created**: 2026-10-19

**Status**: Draft

**Input**: Voice note from the user (2026-10-19, transcribed): one client pays a monthly rate
(e.g. €250). In a month with a vacation or skipped days the client pays less (e.g. €200), and
that is the full, correct payment. Today the Payments page then shows €50 still owed, although
nothing more is due. The only workaround is changing the rate on the client's card, which also
changes every other month. Wanted: on the Payments page, edit the amount she expects to be paid
for that client in that month.

## Clarifications

### Session 2026-10-19

- Q: Should an adjusted month also change the Reports (earnings statistics)? → A: Yes — Payments and Reports both use the adjusted amount.
- Q: Which clients can have a month adjusted? → A: All clients, whatever the rate type.
- Q: How does an adjusted row look? → A: The new amount plus the calculated one in small text («€200 · calc. €250»); tapping opens the edit form with «Reset to calculated».

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set a different expected amount for one month (Priority: P1)

On the Payments page, for a client's row in a given month, the user changes the expected amount
(e.g. €250 → €200). The row, its status and the month totals immediately use the new amount.
The client's card rate and every other month stay as they were.

**Why this priority**: It is the whole request — a reduced month must stop showing as debt.

**Independent Test**: For a €250 monthly client with a €200 payment in October, set October's
expected amount to €200 — the row reads «Paid», the month's outstanding is €0, and September
still expects €250.

**Acceptance Scenarios**:

1. **Given** a monthly client expecting €250 in October with €200 received (status «Partial»),
   **When** the user sets October's expected amount to €200, **Then** the row shows €200 expected,
   status «Paid», and the month's «Expected»/«Outstanding» totals drop by €50.
2. **Given** the October adjustment above, **When** the user opens September or November,
   **Then** those months still expect €250, and the client's card still shows the €250 rate.
3. **Given** the edit form, **When** the user enters an empty, negative or non-numeric amount,
   **Then** saving is blocked with a validation message.
4. **Given** the edit form, **When** the user enters €0, **Then** it is accepted (the month is
   expected to be free) and the row reads «Paid» when nothing was received.
5. **Given** a past month with an adjusted amount fully received, **Then** the row is not marked
   «Overdue».
6. **Given** the user set an amount and then cancels the form, **Then** nothing changes.

---

### User Story 2 - See that a month was adjusted and undo it (Priority: P2)

An adjusted row is visibly marked as adjusted and shows the calculated amount it replaced
(e.g. «€200 · calculated €250»). The user can reset it, after which the row returns to the
calculated amount.

**Why this priority**: Without a visible mark the user can forget an adjustment and misread the
month later; reset makes a mistaken edit cheap to fix.

**Independent Test**: Adjust October to €200 — the row shows the adjusted mark with «€250»;
reset — the row shows €250 and no mark.

**Acceptance Scenarios**:

1. **Given** an adjusted month, **Then** the row shows the adjusted amount, a mark that it was
   changed manually, and the calculated amount.
2. **Given** an adjusted month, **When** the user chooses «Reset to calculated», **Then** the
   adjustment is removed and the row, status and totals use the calculated amount again.
3. **Given** an adjusted month, **When** the calculated amount changes (a cleaning is added or
   the card rate is edited), **Then** the adjusted amount stays in force and the shown
   calculated amount updates.

---

### User Story 3 - Adjustment follows the user across devices and backups (Priority: P2)

An adjustment made on the phone appears on the other device after sync and survives a backup
restore, like payments do today.

**Why this priority**: The app is used on several devices; an adjustment that silently
disappears would bring the false debt back.

**Independent Test**: Adjust a month on device A, sync, open device B — the same month shows the
adjusted amount. Restore a backup taken after the adjustment — the adjustment is there.

**Acceptance Scenarios**:

1. **Given** an adjustment made on device A, **When** device B syncs, **Then** device B shows it.
2. **Given** the same month adjusted differently on two devices, **When** they sync, **Then** the
   most recent edit wins on both devices.
3. **Given** an adjustment reset on device A, **When** device B syncs, **Then** the adjustment is
   gone on device B too (it does not come back).
4. **Given** a backup taken before this feature, **When** it is restored, **Then** restore
   succeeds and no month is adjusted.

### User Story 4 - Reports show the adjusted month (Priority: P2)

Reports for a period that contains an adjusted month count that client's month at the adjusted
amount, so earnings statistics match what was actually agreed.

**Why this priority**: The user chose Payments and Reports to agree; otherwise the month total in
Reports keeps the €50 that will never be paid.

**Independent Test**: Adjust October for a €250 monthly client to €200 — the Reports month view for
October shows €200 for that client and in the grand total; September still shows €250.

**Acceptance Scenarios**:

1. **Given** October adjusted to €200 for a client, **When** Reports shows October, **Then** that
   client's earnings and the grand total count €200 for it (not €250).
2. **Given** the same adjustment, **When** Reports shows a single week or day inside October,
   **Then** each visible cleaning of that client shows its share of the €200 (shares of all the
   month's cleanings add up to €200), in proportion to what each cleaning would have earned at
   the card rate; if the calculated month is €0, the €200 is split evenly across the cleanings.
3. **Given** a period spanning September and October, **Then** September counts at the card rate
   and October at €200.
4. **Given** an adjustment is reset, **Then** Reports return to the card-rate amounts.

### User Story 5 - «Features» guide on the What's new page (Priority: P3)

*Added 2026-10-19 at the user's request mid-implementation, modelled on my-diary's What's new page.*
Opening «What's new» shows a «Features» block first: one collapsed section per area of the app
(cards, calendar, entries, payments, reports, reminders, sync, the app) describing how it works;
the release list follows.

**Acceptance Scenarios**:

1. **Given** the user opens «What's new», **Then** «Features» is the first block, every section
   collapsed, and tapping a section shows its description.
2. **Given** any of uk/en/es, **Then** every section has a title and 3–10 items.

### Edge Cases

- A month with no cleanings but a recorded payment (orphan row, calculated €0): the expected
  amount can be adjusted like any other row.
- Adjusted amount larger than the calculated one (client paid extra by agreement): allowed.
- Archived client: the row stays adjustable, as payments on it stay recordable.
- All cleanings of an adjusted month are deleted and no payment remains: the row disappears from
  the month as today; the adjustment is kept and shows again if a cleaning is added back.
- Amounts with cents (€199.50) are accepted and shown like other amounts.
- An adjustment equal to the calculated amount is still an adjustment (it stays in force if the
  calculation later changes).
- The client card is permanently deleted: its adjustments are deleted with it (like its cleanings).
- Saving or resetting fails (storage error): an error message appears, the form stays open and
  the row keeps its previous amount.
- Reset needs no confirmation — it is one tap and the user can set the amount again.
- Restoring a backup replaces adjustments exactly as it replaces payments today.
- Reports for a custom range that covers part of an adjusted month show the visible cleanings'
  proportional shares (US4-AS2); a month with no cleanings contributes nothing to Reports.
- Amounts are capped at €1,000,000 and compared to the cent (Payments total = Reports total
  to €0.01).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to set, from a client's row on the Payments page, the expected
  amount for that client in that month.
- **FR-002**: An adjustment MUST apply to exactly one client and one month; it MUST NOT change the
  client's card rate or any other month.
- **FR-003**: When an adjustment exists, the row's expected amount, its status (paid / partial /
  unpaid / overdue), the «Mark paid» prefill and the month's totals MUST all use the adjusted
  amount.
- **FR-004**: The adjusted amount MUST be a number ≥ 0 with at most cent precision; invalid input
  MUST be rejected with a message, in the same style as the payment form.
- **FR-005**: An adjusted row MUST show that it was adjusted and the calculated amount it replaces.
- **FR-006**: Users MUST be able to reset an adjustment, returning the row to the calculated amount.
- **FR-007**: Adjustments MUST be kept on the device, synced across devices with the same
  "latest edit wins" rule as payments, and a reset MUST propagate (not be revived by a sync).
- **FR-008**: Adjustments MUST be included in backups and restored with them; backups made before
  this feature MUST still restore.
- **FR-009**: Adjustments MUST be available for every client row regardless of the rate type
  (hourly, fixed, monthly).
- **FR-010**: Reports MUST count an adjusted client-month at the adjusted amount: the client's
  earnings, the grand total and each cleaning's shown amount (its proportional share of the
  adjusted amount, per User Story 4). Months without an adjustment are unchanged.
- **FR-010a**: Other places that show a single cleaning's earnings (calendar, day page, the
  cleaning editor, Google Calendar event text, the cleaning's «Paid» prefill) keep the card-rate
  amount — out of scope for this version.
- **FR-011**: All new texts MUST exist in Ukrainian, English and Spanish.
- **FR-012**: The release MUST be announced in «What's new» with a version bump.
- **FR-013**: «What's new» MUST open with the «Features» guide (US5), in all three languages.

### Key Entities

- **Expected-amount adjustment**: the amount the user expects to receive from one client for one
  month. Attributes: client, month, amount (EUR, ≥ 0), when it was created/last changed. At most
  one per client+month. Never changes the client's rate.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reduced month can be reconciled to «Paid» in at most 3 taps plus typing the amount,
  without leaving the Payments page.
- **SC-002**: After an adjustment, 0 other months and 0 card settings change.
- **SC-002a**: For an adjusted month, the Payments row's expected amount and the Reports month total
  for that client are equal.
- **SC-003**: After sync, both devices show the same adjustments for the same month in 100% of cases.
- **SC-004**: Restoring any existing backup succeeds after the update.

## Assumptions

- The user is the only person editing her data; "latest edit wins" is enough for conflicts.
- Entry point: the expected amount on the row is tappable and opens a small edit form (same
  bottom-sheet style as «Mark paid»); the form also holds «Reset to calculated» when adjusted.
- No note/reason field for the adjustment in this version.
