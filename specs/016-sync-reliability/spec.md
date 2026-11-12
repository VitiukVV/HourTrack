# Feature Specification: Reliable sync between devices

**Feature Branch**: `feature/sync-reliability`

**Created**: 2026-11-12

**Status**: Draft

**Input**: Project audit of 2026-11-12 (code reading, not a user report). The audit found that a
device rarely receives what another device wrote, that every upload can silently replace the
shared copy, and several smaller durability gaps around them. The owner asked to fix all of it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - What I did on the phone shows up on the laptop (Priority: P1)

The user logs hours on her phone during the day. In the evening she opens the app on the laptop —
whether it was closed, or left open since the morning — and sees the phone's entries without
signing in again and without having to edit something first.

**Why this priority**: Today a device picks up remote changes only right after a fresh sign-in, or
when it happens to be started while the previous sign-in is still fresh (about an hour). In daily
use that is almost never.

**Independent Test**: Two devices on one account. Device B adds an entry. Device A, started with an
expired but renewable sign-in, shows the entry shortly after start; a device A that was already
open shows it after the user returns to the app.

**Acceptance Scenarios**:

1. **Given** the stored sign-in has expired but can be renewed, **When** the app starts, **Then**
   the sign-in is renewed and the other device's changes are loaded.
2. **Given** loading at start failed (no network, Google unavailable), **When** the connection
   returns or the user comes back to the app, **Then** loading is tried again without a restart.
3. **Given** the app has been open for hours, **When** the user returns to it after another device
   wrote changes, **Then** those changes appear; returning repeatedly within a short time does not
   reload every time.
4. **Given** this device has newer payments, reminders, month amounts or shopping items than the
   shared copy and nothing else differs, **When** it syncs, **Then** they are uploaded.

---

### User Story 2 - Saving on one device never erases the other device's work (Priority: P1)

Both devices are in use. The user edits on the laptop while the shared copy already contains
entries the phone wrote since the laptop last looked. After the laptop saves, the shared copy
contains both.

**Why this priority**: Today an upload replaces the shared copy with this device's view. The other
device's rows survive only on that device; if it is lost or reinstalled first, they are gone.

**Independent Test**: Device B uploads a new entry. Device A, which has not loaded it, edits a
different entry and uploads. The shared copy holds both entries, and so does device A.

**Acceptance Scenarios**:

1. **Given** the shared copy changed since this device last synced, **When** this device uploads,
   **Then** it first takes in the remote changes and uploads the combined result.
2. **Given** a new device whose first load failed, **When** the user makes a first edit, **Then**
   the existing shared copy is combined with the edit, never replaced by it.
3. **Given** the shared copy was removed on Google's side, **When** two devices sync afterwards,
   **Then** they end up using one shared copy, not one each.
4. **Given** the user closes the tab right after saving while the sign-in is being renewed,
   **When** the app is next opened, **Then** the calendar change for that save is still sent.

---

### User Story 3 - An outdated app does not damage data written by a newer one (Priority: P2)

One device still runs an older version of the app; another already runs a newer one that stores
more kinds of data. The older app stops uploading and tells the user to update, instead of
rewriting the shared copy in the old format.

**Why this priority**: Rare, but it destroys the newer device's new kind of data in the shared copy
without any sign.

**Independent Test**: Put a shared copy marked with a newer format than the app understands; edit
locally — nothing is uploaded, local data is intact, and the user sees «update the app».

**Acceptance Scenarios**:

1. **Given** the shared copy is in a newer format, **When** the app syncs, **Then** it uploads
   nothing, keeps local edits queued, and shows a message asking to update the app.
2. **Given** that state, **When** the app is updated to a version that understands the format,
   **Then** the queued edits sync normally.

---

### User Story 4 - Backups work after the app sat in the background (Priority: P2)

The user opens Settings after the app was idle for a long time and lists, creates or restores a
backup, or re-syncs the calendar. It works without a sign-in error she has to dismiss.

**Independent Test**: With an expired but renewable sign-in, list backups, create one, run an
automatic backup that is due, and start a calendar re-sync — all succeed.

**Acceptance Scenarios**:

1. **Given** an expired but renewable sign-in, **When** the user lists/creates/restores a backup or
   re-syncs the calendar, **Then** the sign-in is renewed and the action succeeds.
2. **Given** Google rejects such a request as unauthorized, **When** renewal succeeds, **Then** the
   request is repeated once.

### Edge Cases

- Offline: no loading is attempted; local work continues and is queued as today.
- Hidden tab: loading waits until the user returns (no Google window pops up in the background).
- Two devices upload within the same few seconds: one upload can still land on top of the other;
  the overwritten device restores its rows into the shared copy at its next sync (which now
  happens during the session, not only at restart). Accepted — Google gives no stronger guarantee.
- The shared copy is unreadable/corrupt: nothing is uploaded over it automatically; the error is
  shown and retried, as today.
- Signed out: nothing is queued or loaded.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: At session start the app MUST load remote changes using a renewed sign-in when the
  stored one is stale, and MUST repeat a request Google rejected as unauthorized once after renewal.
- **FR-002**: A failed load MUST be retried during the session (with growing pauses, and when
  connectivity or visibility returns) until it succeeds.
- **FR-003**: While the session is open the app MUST re-check for remote changes when the user
  returns to the app and when connectivity returns, at most once per 2 minutes after a success.
- **FR-004**: Before every upload the app MUST detect whether the shared copy changed since this
  device last synced, and if so combine it with local data (existing last-write-wins rules) before
  uploading. Detection MUST NOT depend on a response header the browser cannot read.
- **FR-005**: When this device does not yet know the shared copy, an upload MUST always combine
  with whatever exists remotely; it MUST NOT replace it.
- **FR-006**: The decision «does this device have something to upload» MUST consider every synced
  kind of data: cards, entries, payments, reminders, month amounts, shopping items, deletions.
- **FR-007**: When the known shared copy is reported missing, the app MUST look for an existing one
  before creating a new one.
- **FR-008**: When the shared copy is in a newer format than the app understands, the app MUST NOT
  upload, MUST keep local changes queued, and MUST tell the user to update the app (all three
  languages). The message MUST also be visible in the sync indicator.
- **FR-009**: Queuing a change for sync MUST NOT wait for a sign-in renewal.
- **FR-010**: Backup list/create/restore, automatic backup and calendar re-sync MUST use a renewed
  sign-in when the stored one is stale and repeat once after an unauthorized response.
- **FR-011**: Loads and uploads MUST never run concurrently with each other on one device.
- **FR-012**: Existing behaviour is kept: last-write-wins per row, deletion markers, local-first
  ties, device-local bookkeeping, offline queue, backoff, no sign-out on a transient failure.

### Maintenance requirements (not user-visible)

- **MR-001**: Unit tests MUST fail loudly on any real network request; the test that currently
  reaches Google MUST be fixed.
- **MR-002**: The fake Drive used by tests MUST behave like the real one: no readable ETag.
- **MR-003**: Stale comments named by the audit are corrected; CI runs the unit tests once; the
  installed app is not locked to portrait; the finished «improvements from my-diary» note moves to
  the archive.

### Key Entities

- **Shared copy**: the single data file in the user's Google Drive app folder.
- **Remote revision**: a marker of the shared copy's state that this device remembers from its last
  sync, used to tell «unchanged» from «changed». Device-local bookkeeping, never synced.

## Success Criteria *(mandatory)*

- **SC-001**: A change made on device B is visible on device A within 10 seconds of A being started
  or brought to the foreground (online), with no manual action.
- **SC-002**: In a two-device simulation where each device uploads without having seen the other's
  latest change, the shared copy contains 100% of both devices' rows after each upload.
- **SC-003**: With an unchanged shared copy, an upload makes no download of the data file.
- **SC-004**: With a newer-format shared copy, zero uploads happen and the user sees the update
  message.
- **SC-005**: The unit-test run makes zero real network requests.

## Clarifications

Decided by the implementer (the owner asked for no approval stops); the owner reviews afterwards.

- Re-check interval: 2 minutes minimum between successful loads (FR-003).
- Near-simultaneous uploads are accepted as an eventually-healed edge case (see Edge Cases).
- Portrait lock is removed (`orientation` → `any`); the layout is already responsive.
- Release: patch 1.12.1 with a «What's new» entry; the Guide block is unchanged (no new capability).

## Assumptions

- Google Drive reports a per-file `version` that changes on every modification and is readable by
  the browser in the response body.
- The data file stays small enough (hundreds of KB) to download on a detected change.
