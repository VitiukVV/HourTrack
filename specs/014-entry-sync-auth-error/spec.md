# Feature Specification: Expired-sign-in sync errors and the overflowing entry dialog

**Feature Branch**: `feature/shopping-list-and-sync-fix`

**Created**: 2026-10-30

**Status**: Draft

**Input**: Voice note + two phone screenshots from the user (2026-10-30, transcribed): «it still
often shows this error, especially when I write a note. Then the window becomes not mobile but
desktop-sized — I have to scroll sideways, sideways, sideways to press close. It does save, but
this error pops up.» Screenshots: the entry dialog shows «⚠ Помилка синхронізації: Calendar API
error 401 Unauthorized: … authentication credential. See https://develo…» on one line; the
dialog is wider than the screen and Close / Save / «Заплатили» are only reachable by scrolling
right.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Edits sync to the calendar after the app was in the background (Priority: P1)

The user opens the app on her phone after it sat in the background for a while (longer than a
Google sign-in stays fresh), edits an entry — e.g. writes a note — and saves. The change reaches
Google Calendar without an error; she never sees a sync error for an expired sign-in that the app
could renew by itself.

**Why this priority**: It is the error she sees «often». The data is saved locally, but the red
banner makes every edit look broken.

**Independent Test**: With a stored sign-in whose access has expired but can still be renewed,
edit an entry — the calendar event is updated and the entry shows no sync error.

**Acceptance Scenarios**:

1. **Given** the sign-in has expired but can be renewed, **When** the user saves an entry,
   **Then** the app renews the sign-in, the calendar is updated, and no sync error is shown.
2. **Given** Google rejects a calendar or backup request as unauthorized, **When** the app can
   renew the sign-in, **Then** the request is repeated once with the renewed sign-in and succeeds.
3. **Given** the sign-in cannot be renewed (no network, access withdrawn), **When** the user saves,
   **Then** the entry is still saved locally, the sync error is shown with «Retry», and the app
   does not loop retrying immediately.
4. **Given** several entries are queued for the calendar at once, **When** the sign-in is expired,
   **Then** it is renewed once for the whole batch, not once per entry.

---

### User Story 2 - The entry dialog fits the phone screen even with a sync error (Priority: P1)

When an entry has a sync error, the warning wraps onto several lines inside the dialog. The dialog
stays as wide as the screen; Close, Delete, Cancel, Save and «Paid» are reachable without
horizontal scrolling.

**Why this priority**: Today the error makes the dialog unusable on a phone — that is the bug she
reported, independent of why the error happened.

**Independent Test**: On a 390 px-wide screen, open an entry whose sync failed with a long error —
the dialog has no horizontal scroll and every button is fully visible.

**Acceptance Scenarios**:

1. **Given** an entry with a long sync error, **When** its dialog opens on a phone-width screen,
   **Then** the dialog is no wider than the screen and nothing scrolls sideways.
2. **Given** that dialog, **Then** the whole warning text is readable (wrapped, not cut off) and
   the «Retry» button stays visible.
3. **Given** the same entry on the day page (not the dialog), **Then** the editor also stays within
   the page width.

---

### User Story 3 - The error says what happened in her language (Priority: P2)

When a sync fails because the Google sign-in has expired and could not be renewed, the warning says
so in the interface language («Google sign-in expired — tap Retry or sign in again») instead of the
raw English API message with a URL.

**Why this priority**: Improves the rare case that remains after Story 1; not needed for the fix.

**Independent Test**: Force an unrenewable expired sign-in, save an entry with the interface in
Ukrainian — the warning is in Ukrainian and contains no API text or URL.

**Acceptance Scenarios**:

1. **Given** an unrenewable expired sign-in, **When** the entry's sync fails, **Then** the warning
   shows the localized «sign-in expired» message in uk / en / es.
2. **Given** any other sync failure, **Then** the warning keeps the generic localized «Sync error»
   prefix with the detail, wrapped as in Story 2.

### Edge Cases

- The renewal itself needs a Google pop-up (no long-lived sign-in stored) — it must not open while
  the app is in the background; the request stays queued and syncs when the app is visible.
- The background renewal timer and a save renew at the same moment — only one renewal happens and
  both use its result.
- The renewed sign-in belongs to a different Google account — treated as sign-in lost (existing
  behavior), nothing is sent.
- Offline save — unchanged: stays queued, no error for the expired sign-in.
- Entry errors stamped before this fix stay visible until the next successful sync or «Retry».

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Before sending queued calendar or backup changes, the app MUST renew the Google
  sign-in when its access has expired or expires within the next minute.
- **FR-002**: When Google rejects a calendar or backup request as unauthorized, the app MUST renew
  the sign-in and repeat the request once; a second rejection is recorded as a sync error.
- **FR-003**: Concurrent renewals (background timer, sync, retries) MUST be merged into a single
  renewal.
- **FR-004**: A failed renewal MUST NOT sign the user out unless the existing rules already treat it
  as sign-in lost (grant withdrawn, different account).
- **FR-005**: The sync warning in the entry editor MUST wrap its text and MUST NOT make the editor or
  its dialog wider than the viewport.
- **FR-006**: An entry sync error caused by an expired, unrenewable sign-in MUST be shown as a
  localized message (uk / en / es) without the raw API text.
- **FR-007**: Local saving MUST be unaffected by any sync failure (existing behavior).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Editing an entry after the app has been in the background for over an hour produces no
  sync error when the sign-in can be renewed (0 errors in the reproduction scenario).
- **SC-002**: At phone width (360–430 px) the entry dialog with a sync error has zero horizontal
  scroll, and all its buttons are fully on screen.
- **SC-003**: At most one sign-in renewal per sync run, regardless of how many changes are queued.

## Assumptions

- The 401 is caused by an expired access token after the phone suspended the app's background
  renewal timer; renewing works once the app is in the foreground (current renewal flow).
- Retrying exactly once after renewal is enough; persistent failures keep the existing
  backoff-and-«Retry» behavior.
- A user-visible fix → patch release (1.11.1) with a «What's new» entry.
