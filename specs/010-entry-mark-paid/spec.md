# Feature Specification: Mark paid from a cleaning's card

**Feature Branch**: `feature/entry-mark-paid`

**Created**: 2026-10-06

**Status**: Draft

**Input**: Voice note from the user (2026-10-06, transcribed): some clients (e.g. Amparo) pay per
day / per week, not per month. Recording such a payment today means going to Payments, opening
the client's month, typing the amount, picking the date and saving. Wanted: open the cleaning's
card from the calendar and press «Paid» right there; the amount is prefilled with what that
cleaning is expected to earn but can be corrected when the client paid more or less. Monthly
clients keep being marked from the Payments page as today.

## Clarifications

### Session 2026-10-06

- Q: Should a cleaning remember that it was paid? → A: Yes, and the calendar marks paid cleanings too.
- Q: Default payment date? → A: The cleaning's date (editable).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a payment for one cleaning (Priority: P1)

The user opens a cleaning (entry) from the calendar and presses «Paid». A short form opens with
the amount prefilled from that cleaning's earnings; she confirms (optionally correcting the
amount) and the payment is recorded against that client and that cleaning's month.

**Why this priority**: It is the whole request — it replaces a five-step trip to the Payments page.

**Independent Test**: Open an hourly client's cleaning from the calendar, press «Paid», confirm;
the Payments page for that month shows the payment and the outstanding balance drops by it.

**Acceptance Scenarios**:

1. **Given** an hourly/fixed client's cleaning earning €42, **When** the user presses «Paid» and
   confirms without edits, **Then** a €42 payment is recorded for that client in the cleaning's
   month and a confirmation with Undo appears.
2. **Given** the same form, **When** the user changes the amount to €50 and confirms, **Then** the
   recorded payment is €50.
3. **Given** a just-recorded payment, **When** the user presses Undo, **Then** the payment is removed.
4. **Given** the form, **When** the user enters 0, an empty or a negative amount, **Then** saving is
   blocked with the same validation messages as on the Payments page.

---

### User Story 2 - See and change a cleaning's payment (Priority: P2)

Once a cleaning has a payment, its card shows «Paid €X» instead of the «Paid» button. Tapping it
reopens the form to correct the amount/date/note or to remove the payment.

**Why this priority**: Prevents recording the same cleaning twice and makes corrections easy.

**Independent Test**: Mark a cleaning paid, reopen it — it reads «Paid €42»; change to €40 — the
Payments page shows €40; remove it — the card offers «Paid» again.

**Acceptance Scenarios**:

1. **Given** a cleaning with a €42 payment, **When** the user opens its card, **Then** it shows
   «Paid €42» and no button that would record a second payment.
2. **Given** that card, **When** the user edits the payment to €40, **Then** the card and the
   Payments page both show €40.
3. **Given** that card, **When** the user removes the payment, **Then** the card offers «Paid»
   again and the Payments totals drop by €42.
4. **Given** the payment was deleted or edited from the Payments page, **When** the user opens the
   cleaning, **Then** the card reflects that change.

---

### User Story 3 - Paid cleanings are marked on the calendar (Priority: P3)

Cleanings that have a payment carry a small «paid» mark on the calendar, so a glance at the week
shows which days a per-day client has already paid for.

**Why this priority**: Nice overview; the core value is already delivered by US1–US2.

**Independent Test**: Mark one of two cleanings paid; the calendar marks only that one, in the
month view and the week grid and agenda.

**Acceptance Scenarios**:

1. **Given** a paid and an unpaid cleaning, **When** the user views the calendar, **Then** only the
   paid one carries the mark, and the mark has an accessible label.
2. **Given** the payment is removed, **Then** the mark disappears without a reload.

---

### Edge Cases

- Cleaning of a **monthly** client: the «Paid» action is not offered (monthly retainers are
  marked from the Payments page); a monthly cleaning with a custom amount is treated the same.
- Cleaning whose computed earnings are 0 (e.g. rate 0): the form opens with an empty amount.
- Cleaning in a past month: the payment goes to the cleaning's month, not the current one.
- Archived client: the action still works (money owed doesn't depend on archiving).
- The save fails: an error message is shown and nothing is recorded silently.
- Two devices: the payment and its link to the cleaning sync like any other payment.
- Cleaning deleted: its payment stays (the money was received) and keeps counting in the
  Payments totals; it just no longer belongs to a visible cleaning.
- Cleaning dragged to another month after being paid: the payment keeps its original month.
- Payments recorded the old way (from the Payments page) are not tied to any cleaning and don't
  mark cleanings as paid.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The cleaning's card opened from the calendar MUST offer a «Paid» action for clients
  that are not billed monthly.
- **FR-002**: The «Paid» form MUST prefill the amount with that cleaning's expected earnings
  (the same number the card already shows), rounded to cents, and let the user change it.
- **FR-003**: The form MUST prefill the payment date with the cleaning's date, editable.
- **FR-004**: The payment MUST be recorded for the cleaning's client and the cleaning's month, so
  the Payments page totals include it with no extra steps.
- **FR-005**: After recording, the user MUST get a confirmation with Undo, as on the Payments page.
- **FR-006**: Amount/date/note validation MUST match the Payments page.
- **FR-007**: The Payments page flow MUST keep working unchanged.
- **FR-008**: A payment recorded from a cleaning MUST stay linked to that cleaning; the card MUST
  show «Paid €X» for it and allow editing or removing it instead of recording another one.
- **FR-009**: The calendar MUST mark cleanings that have a linked payment in the month view and the
  week grid and agenda (the Day page shows it on the card itself).
- **FR-010**: The link MUST survive sync and backup/restore; data from older versions (no link)
  MUST keep loading.
- **FR-011**: «What's new» MUST describe the feature in all three languages.

### Key Entities

- **Payment**: money received from a client for a month (amount, date paid, note), optionally
  linked to the one cleaning it was recorded from.
- **Cleaning (entry)**: one work session for a client on a date, with its expected earnings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Recording a per-cleaning payment takes 2 taps from the open cleaning (Paid → Confirm)
  instead of ≥5 steps through the Payments page.
- **SC-002**: A payment recorded from a cleaning shows up in that month's Payments totals
  immediately, with the same numbers as one recorded from the Payments page.
- **SC-003**: No regressions: all existing tests and checks pass.

## Assumptions

- "Planned amount" = the cleaning's expected earnings as the app already computes them
  (per-hour or fixed rate, or the cleaning's custom amount).
- The note is optional and empty by default.
- Each cleaning is marked paid on its own (per-day payers). A weekly lump sum is recorded from one
  cleaning with the amount corrected; only that cleaning gets the paid mark — no multi-select in
  this version.
- The «Paid» action lives in the cleaning editor, so it also appears where that editor is used on
  the Day page.
