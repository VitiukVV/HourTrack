# Feature Specification: Pinned Payments header, card filter above the Reports title

**Feature Branch**: `feature/sticky-payments-reports-chips`

**Created**: 2026-10-19

**Status**: Draft

**Input**: Two voice notes from the user (2026-10-19, transcribed):
1. «On the Payments page, the month and the Expected / Received / Outstanding columns should stay
   pinned at the top, so when I scroll the page down they stay at the top and I can switch months.»
2. «On the Reports page, put the row with the cards at the very top, so when I take a screenshot
   other clients don't see the names of the cards I have in the app, but do see the period of the
   report I send them.»

## Clarifications

### Session 2026-10-19

- Q: Where exactly does the Reports card row go? → A: Above the page title — first thing on the page.
- Q: What stays pinned on Payments? → A: Month switcher + the three totals; the «Payments» title scrolls away.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Payments month and totals stay pinned (Priority: P1)

On the Payments page, with many client rows, the user scrolls down. The month switcher
(‹ October 2026 ›) and the Expected / Received / Outstanding totals stay at the top of the screen,
below the app's top bar, and she can switch months without scrolling back up.

**Independent Test**: With enough rows to scroll, scroll to the bottom — the month switcher and
totals are still visible at the top; tapping › shows the next month.

**Acceptance Scenarios**:

1. **Given** a month whose rows don't fit the screen, **When** the user scrolls down, **Then** the
   month switcher and the three totals stay visible under the app's top bar; the rows pass
   beneath them (not over them, not see-through).
2. **Given** the user has scrolled down, **When** she taps ‹ or › or picks a month, **Then** the
   month changes and the totals update while the header stays pinned.
3. **Given** the page title «Payments», **When** the user scrolls, **Then** the title scrolls away.

---

### User Story 2 - Reports card row sits above everything (Priority: P1)

On the Reports page, the card row (card chips, «Reset cards», «Show archived») is the first thing
on the page, above the «Reports» title. Below it come the title, the period controls, the totals
and the table, so a screenshot that starts below the card row shows the period and the report
but no card names apart from the ones in the report itself.

**Independent Test**: Open Reports — the card row is above the «Reports» title; everything from
the title down contains no card chips.

**Acceptance Scenarios**:

1. **Given** the Reports page, **Then** the order top-to-bottom is: card row, title, period
   presets + Reset, period picker, totals, table.
2. **Given** the user scrolls down, **Then** the period presets and picker stay pinned under the
   app's top bar (as today) and the card row scrolls away with the page.
3. **Given** filters were set before the change, **Then** they keep working as before (selection,
   reset cards, show archived, period, reset).

### Edge Cases

- The cards list failed to load or there are no cards: the card row shows its existing message in
  the same top position.
- Short pages that don't scroll: nothing changes visually besides the new order.
- Opening the month picker from the pinned Payments header still shows the picker above the rows.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On Payments, the month switcher and the Expected / Received / Outstanding totals MUST
  stay visible under the app's top bar while the page scrolls, with rows passing underneath.
- **FR-002**: Month switching MUST work from the pinned header with no change in behaviour.
- **FR-003**: On Reports, the card row MUST be rendered above the page title.
- **FR-004**: On Reports, the period controls MUST stay pinned while the page scrolls, for the
  whole length of the report, and the card row MUST NOT be pinned.
- **FR-005**: No filter, total or payment behaviour changes.
- **FR-006**: The change MUST be announced in «What's new» (patch release) in uk/en/es, and the
  «Features» guide updated where it describes these pages.

## Success Criteria *(mandatory)*

- **SC-001**: On a phone-size screen, after scrolling to the end of Payments or Reports, the
  month/period controls are visible without scrolling back.
- **SC-002**: A Reports screenshot cropped from the title downwards contains zero card chips.

## Assumptions

- «Very top» means the top of the page content, under the app's own top bar (which stays as is).
- The pinned area keeps the page background so content scrolling under it is hidden.
