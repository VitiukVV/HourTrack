# Feature Specification: System notifications for reminders (Android PWA)

**Feature Branch**: `feature/pwa-notifications`

**Created**: 2026-10-20

**Status**: Draft

**Input**: User request (2026-10-20): «Analyse and somehow set up notifications for the site — it is used
as a PWA on the phone.» Follow-up answers: the phone is Android (Chrome); no backend — the app stays
fully client-side.

## Context

Today a reminder that comes due produces: an in-app toast (only while the app is open and visible), the
due-reminders banner (for reminders that came due while the app was closed) and a Google Calendar event
with a popup at the due minute. The app itself never posts an OS notification, so a reminder that comes
due while the app is in the background goes unnoticed unless the Google Calendar app catches it.

Without a server the app cannot wake itself up once it is closed or frozen by the OS. This feature
covers the window in which the app is still alive (open, or recently sent to the background) and makes
the remaining gap explicit to the user.

## Clarifications

### Session 2026-10-20

- Q: Reminder comes due while the app is open and visible — toast, or toast plus system notification? → A: Toast only; the system notification is posted only when the app is in the background.
- Q: Should the notification carry a «Done» action? → A: Yes — same effect as «Done» in the app.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn notifications on in Settings (Priority: P1)

In Settings → Notifications the user sees whether system notifications are on, taps «Enable
notifications», approves the phone's permission prompt, and can send a test notification to confirm it
arrives in the notification shade.

**Why this priority**: Nothing else works without the permission, and the browser only lets the app ask
for it in response to a tap.

**Independent Test**: Open Settings on a phone with notifications never asked → enable → approve →
tap «Send test notification» → a HourTrack notification appears.

**Acceptance Scenarios**:

1. **Given** permission was never asked, **When** the user opens Settings → Notifications, **Then** the
   section shows notifications as off and an «Enable notifications» button; no permission prompt
   appears on its own.
2. **Given** permission was never asked, **When** the user taps «Enable notifications» and approves,
   **Then** the section shows notifications as on and offers «Send test notification».
3. **Given** the user taps «Enable notifications» and declines, **Then** the section shows that
   notifications are blocked and explains how to allow them in the phone's site/app settings; the
   enable button is not offered again (it would do nothing).
4. **Given** notifications are on, **When** the user taps «Send test notification», **Then** a system
   notification with the app name and icon appears within a few seconds.
5. **Given** notifications are on, **When** the user switches them off in the section, **Then** no
   further reminder notifications are posted from this device (the OS permission itself stays as is).
6. **Given** the device/browser has no notification support, **Then** the section says notifications are
   not supported on this device and shows no controls.
7. The section always states that when the app is closed, reminders arrive through the Google Calendar
   popup (and only if Calendar sync is on).

---

### User Story 2 - A due reminder posts a system notification (Priority: P1)

The user sets a reminder for 14:00, then switches to another app. At 14:00 a HourTrack notification with
the reminder text appears in the notification shade.

**Why this priority**: This is the actual value — reminders that are noticed without looking at the app.

**Independent Test**: With notifications on, create a reminder due in 2 minutes, send the app to the
background, wait → a notification with the reminder text appears exactly once.

**Acceptance Scenarios**:

1. **Given** notifications are on and the app is in the background, **When** a reminder comes due,
   **Then** one system notification with the reminder text is posted.
2. **Given** notifications are on and the app is open and visible, **When** a reminder comes due,
   **Then** only the in-app toast is shown (no system notification), exactly as today.
3. **Given** a reminder already notified (by toast or system notification), **When** the app is reopened
   or another tick runs, **Then** it is not notified again — on this device or another one that has
   synced the "notified" mark.
4. **Given** notifications are off or not permitted, **When** a reminder comes due, **Then** behaviour is
   exactly as today (in-app toast while visible, banner otherwise).
5. **Given** a reminder came due while the app was closed, **When** the app is opened, **Then** it is
   shown in the existing due-reminders banner and no system notification is posted for it.

---

### User Story 3 - Acting on the notification (Priority: P2)

The user taps the reminder notification and lands in HourTrack with the reminder visible; or taps the
notification's «Done» action and the reminder is marked done without opening the app UI.

**Why this priority**: Makes the notification useful beyond a ping, but US2 already delivers the core.

**Independent Test**: Trigger a reminder notification → tap it → the app comes to the front (reusing the
already-open window if there is one) with the reminders list open. Trigger another → tap «Done» → the
reminder is marked done and its notification disappears.

**Acceptance Scenarios**:

1. **Given** a reminder notification, **When** the user taps its body, **Then** the existing app window is
   focused (or a new one opened if none) and the reminders list is shown; the notification is dismissed.
2. **Given** a reminder notification, **When** the user taps «Done», **Then** the reminder becomes done,
   with the same side effects as marking it done in the app (sync, calendar clean-up), and the
   notification is dismissed.
3. **Given** the reminder was already completed or deleted elsewhere, **When** the user taps the
   notification, **Then** the app opens without error; «Done» is a no-op.

### Edge Cases

- The OS freezes or kills the backgrounded app: reminders due in that period are not notified by the app;
  they appear in the banner on next open (and through Calendar, if enabled). The Settings explanation
  must make this limitation clear.
- Permission revoked in phone settings after enabling: the section reflects «blocked» the next time it
  is shown, and reminders silently fall back to today's behaviour.
- Several reminders come due in the same minute: one notification per reminder; they do not replace each
  other.
- The same reminder is open in two windows/tabs: it is notified once.
- Test notification tapped: opens/focuses the app, does nothing else.
- Language change: notification text uses the app's current language at the moment it is posted.
- Permission prompt dismissed without a choice: the section stays «off» and «Enable notifications» stays
  available.
- Permission already granted (e.g. earlier session) and the switch is off: «Enable» turns notifications
  on without showing a prompt.
- Reminder edited, completed or deleted after its notification was posted: the notification is removed
  from the shade the next time the app runs a reminder check; tapping a stale one only opens the app.
- Notifications stay in the shade until the user dismisses or acts on them.
- «Done» from the notification cannot be saved (e.g. local storage unavailable): the reminder stays
  open, so it shows in the banner and bell the next time the app is in front.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Settings MUST have a Notifications section showing one of: not supported, off, on, blocked.
- **FR-002**: The app MUST request notification permission only from an explicit user tap in that
  section — never automatically.
- **FR-003**: The user MUST be able to switch reminder notifications off and on again on a device without
  changing the OS permission; the choice is per device and is not synced to other devices.
- **FR-004**: When notifications are on and permitted, a reminder that comes due while the app is running
  in the background MUST produce exactly one system notification containing the reminder text.
- **FR-005**: A reminder MUST be notified at most once across toast and system notification, using the
  existing "notified" mark.
- **FR-006**: Reminders whose due moment is before the app (re)started its reminder checks — i.e. came due while the app was not running — MUST NOT produce system
  notifications on next start (the banner covers them).
- **FR-007**: Tapping a reminder notification MUST focus an existing app window or open one, and show the
  reminders list (the reminder bell list in the app header).
- **FR-008**: A reminder notification MUST offer a «Done» action with the same effect as «Done» in the app.
- **FR-009**: The section MUST offer «Send test notification» while notifications are on.
- **FR-010**: The section MUST explain that the app can notify only while it is open or recently in the
  background, and that the Google Calendar popup covers the closed-app case when Calendar sync is on.
- **FR-011**: When notifications are unsupported, off or not permitted, reminder behaviour MUST be
  unchanged from today.
- **FR-012**: All new UI and notification text MUST exist in English, Ukrainian and Spanish.
- **FR-013**: The release MUST bump the minor version and add a «What's new» entry and a «Features» guide
  item describing notifications, per the project release process.

### Key Entities

- **Notification preference** (per device): on/off flag; default off; not part of synced data.
- **Reminder** (existing): text, due date/time, done mark, "notified" mark — reused, no new fields.

## Success Criteria *(mandatory)*

- **SC-001**: With notifications on and the app in the background for under 5 minutes, a reminder
  notification appears within 1 minute of its due time in 9 of 10 trials on the user's Android phone.
- **SC-002**: Zero duplicate notifications for one reminder across reopen, multiple windows and sync.
- **SC-003**: Enabling notifications takes at most 2 taps from opening the Settings section.
- **SC-004**: With notifications off, every existing reminder test still passes unchanged.

## Assumptions

- Target is the installed PWA in Chrome on Android; iOS and desktop get the generic behaviour (works if
  the browser supports it, «not supported» otherwise) but are not tuned or tested.
- No server, Web Push or background sync is added; closed-app delivery stays with Google Calendar.
- Background delivery is best effort: Android may freeze the app after a few minutes in the background.
- Default for a device is «off» until the user enables notifications.
