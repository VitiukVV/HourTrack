# Feature Specification: Shopping list per house

**Feature Branch**: `feature/shopping-list-and-sync-fix`

**Created**: 2026-10-30

**Status**: Draft

**Input**: Voice note from the user (2026-10-30, transcribed): «I'd like a page where I can write
down purchases — what is running out in a house, white bags and so on. For each house I could add
notes right away, then mark them when they're bought. What isn't bought should stay — carry over to
the next month.» A «house» is a client card (Anabel, Carlos, Raquel …).

## Clarifications

### Session 2026-10-30

- Q: What happens to a bought item after it is ticked? → A: It stays struck through until the end of that month; in later months it is gone, but it is visible when stepping back to the month it was bought in.
- Q: Where is the Purchases page? → A: A new tab in the main navigation (bottom bar on phones, top bar on desktop): Calendar · Reports · Payments · Purchases · Settings.
- Q: Which houses does the page show? → A: Every active card, each in its own block with its own «Add» field; blocks with no items for the month are collapsed to just the house name and expand on tap.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write down what a house needs (Priority: P1)

On a new «Purchases» page the user picks a house and adds items to its list («White bags»,
«Dishwasher tablets»). Each house has its own list, labelled with the house's name and color.

**Why this priority**: Capturing the item at the moment she notices it is the core need.

**Independent Test**: Open «Purchases», add «White bags» to Raquel — it appears under Raquel and
is still there after reloading the app.

**Acceptance Scenarios**:

1. **Given** the Purchases page, **When** the user adds «White bags» to Raquel, **Then** it appears
   in Raquel's list as not bought.
2. **Given** an empty or whitespace-only item, **When** the user tries to add it, **Then** nothing is
   added.
3. **Given** an item, **When** the user edits its text or deletes it, **Then** the list updates; a
   deleted item does not come back after a sync.
4. **Given** a house with no items, **Then** its block is collapsed to the house name; tapping it
   opens the «Add» field for the first item.

---

### User Story 2 - Mark items as bought (Priority: P1)

When an item is bought the user ticks it. It is shown as bought (struck through) and no longer
counts as needed. A wrong tick can be undone.

**Why this priority**: Without marking, the list only grows and stops being useful.

**Independent Test**: Tick «White bags» in Raquel — it shows as bought; untick — it is needed again.

**Acceptance Scenarios**:

1. **Given** a needed item, **When** the user ticks it, **Then** it is shown as bought and the
   house's count of needed items drops by one.
2. **Given** a bought item, **When** the user unticks it, **Then** it is needed again.
3. **Given** bought items, **Then** they stay visible, struck through and listed after the needed ones, until
   the end of the month they were bought in.

---

### User Story 3 - Unbought items carry over to the next month (Priority: P1)

Lists are kept per month. When a new month starts, everything not bought yet is still on each
house's list; items bought last month are not.

**Why this priority**: It is the explicit «what isn't bought should stay» rule.

**Independent Test**: In October add «Bags» and «Soap», tick «Soap». Move the date to November —
Raquel's list shows only «Bags», still needed.

**Acceptance Scenarios**:

1. **Given** needed items at the end of a month, **When** the next month starts, **Then** they
   appear in that month's list unchanged, without the user doing anything.
2. **Given** items bought in October, **When** the user looks at November, **Then** they are not
   shown.
3. **Given** the user switches back to October, **Then** October shows what was bought in October.

---

### User Story 4 - The list is on every device (Priority: P2)

The purchases list syncs through the same Google Drive backup as the rest of the data, so adding an
item on the phone shows it on the computer.

**Why this priority**: The app is used on several devices; a list on one phone only is easy to lose.

**Independent Test**: Add an item on device A, sync, open device B — the item is there; delete it on
B — it disappears on A after sync.

**Acceptance Scenarios**:

1. **Given** two devices signed in to the same account, **When** an item is added, edited, ticked or
   deleted on one, **Then** the other shows the same state after sync; the latest change wins.
2. **Given** a backup restore, **Then** purchases are restored together with the rest of the data.

### Edge Cases

- A house is archived — its needed items are hidden from the page but kept; restoring the house
  brings them back. A house deleted for good — its items are deleted too.
- A very long item text wraps inside the list on a phone; nothing scrolls sideways.
- Many items (50+) in one house — the list stays usable (scrolls vertically).
- Item ticked as bought on the last day of the month near midnight — it belongs to the month of the
  device's local date when it was ticked.
- A future month shows only the items still needed (nothing can be bought there yet).
- Within a block: needed items first (oldest first), then bought items (most recently bought first).
- Unticking an item makes it needed again; it then follows the carry-over rule like any needed item.
- No active houses at all — the page shows a short hint to add a client card first.
- Older app version on another device opens a backup that contains purchases — it must not lose or
  break them (existing backup-compatibility rules).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST provide a «Purchases» page reachable from a new «Purchases» tab in the main
  navigation, placed between «Payments» and «Settings».
- **FR-002**: The page MUST show one block per active house, ordered like the houses elsewhere in
  the app, each labelled with the house's name and color and the count of needed items. A block
  with no items for the viewed month is collapsed to its header and expands on tap.
- **FR-003**: Users MUST be able to add an item (free text, 1–200 characters after trimming) to a
  house's list, edit its text, and delete it.
- **FR-004**: Users MUST be able to mark an item bought and undo that.
- **FR-005**: For the month being viewed, a list MUST contain every item not bought by the end of
  that month (created on or before it) plus the items bought during that month.
- **FR-006**: The page MUST default to the current month and let the user step to previous/next
  months.
- **FR-007**: Items MUST be saved on the device immediately and work offline.
- **FR-008**: Items MUST sync across devices and be included in backup/restore, with deletions
  propagated and the latest change winning.
- **FR-009**: The page and all its texts MUST be available in uk / en / es.
- **FR-010**: On phone-width screens the page MUST have no horizontal scroll.

### Key Entities

- **Purchase item**: something a house needs — the house it belongs to, the text, when it was
  added, when it was bought (or not yet), when it was last changed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Adding an item takes at most 3 taps plus typing from the Purchases page.
- **SC-002**: 100% of items not bought at the end of a month appear in the next month's list with
  no user action.
- **SC-003**: An item added on one device appears on another after the next sync, and a deleted one
  never reappears.
- **SC-004**: At 360–430 px width the page has zero horizontal scroll.

## Assumptions

- «House» = an existing client card; no separate house entity. Archived cards are excluded.
- No quantities, prices, shops or photos — an item is plain text (she can write «2× bags»).
- Ticking/unticking does not create calendar events or reminders.
- New feature → minor release (1.12.0) with «What's new» and a new «Purchases» section in the
  Features guide.
