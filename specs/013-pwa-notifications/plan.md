# Implementation Plan: System notifications for reminders (Android PWA)

**Spec**: `specs/013-pwa-notifications/spec.md` · **Branch**: `feature/pwa-notifications`

## Design

No new data fields, no Dexie/Drive schema change. Four pieces:

**1. Per-device preference + capability (`src/features/notifications/`).**
- `notificationPrefs.ts` — `hourtrack:notificationsEnabled` in `localStorage`, read/write wrapped in
  try/catch exactly like `useWhatsNewSeen` (not a synced `Settings` field: permission is per device).
- `notificationSupport.ts` — pure helpers: `getNotificationStatus()` →
  `'unsupported' | 'off' | 'on' | 'blocked'` from `'Notification' in window`, `'serviceWorker' in
  navigator`, `Notification.permission` and the pref (FR-001/003); `getSwRegistration()` →
  `navigator.serviceWorker.getRegistration()` (undefined in dev, where the SW is disabled).
- `useNotificationStatus.ts` — hook: status + `enable()` (requests permission only if it is
  `default`, sets the pref on `granted`), `disable()`, `sendTest()`. Re-reads permission on
  `visibilitychange`, so a permission revoked in phone settings shows on return.

**2. Posting (`showReminderNotification.ts`).** `registration.showNotification(title, { body: text,
tag: 'reminder:<id>', data: { reminderId }, icon: '/icons/pwa-192x192.png', actions: [{ action:
'done', title: t('reminders.done') }] })`. The `tag` makes the OS collapse a duplicate from a second
tab into one entry (FR-005, SC-002). `closeStaleReminderNotifications(openIds)` closes shown
notifications whose reminder is no longer open (edited time is fine — only done/deleted are closed).

**3. Scheduler change (`RemindersScheduler.tsx`).** Same tick, same `selectDueToasts` window
(FR-006 unchanged). Per due reminder: stamp `notifiedAt` (as today), then
`document.visibilityState === 'hidden' && status === 'on'` → system notification, else toast
(clarification: visible = toast only). If posting throws, fall back to the toast so the reminder is
never silently lost. Each tick also calls `closeStaleReminderNotifications`.

**4. Service worker click handling.** The SW stays `generateSW`; `workbox.importScripts:
['sw-notifications.js']` pulls in a small hand-written `public/sw-notifications.js` (plain JS,
precached by the existing `globPatterns`). `notificationclick` (wrapped so a failure is logged):
- closes the notification;
- finds a window client (`clients.matchAll({ type: 'window', includeUncontrolled: true })`);
- action `done` → `postMessage({ type: 'hourtrack:reminder-done', id })` to it without focusing;
  no client → `clients.openWindow('/?reminderDone=<id>')`;
- «Done» to an open window carries a `MessageChannel` port; `NotificationBridge` acks on it. No ack
  within 2 s (sign-in screen, frozen tab) or `openWindow` refused → the notification is re-shown, so
  the tap is never silently lost (review finding H1). A later-processed message still completes it and
  the next tick closes the re-shown copy;
- body tap → `focus()` + `postMessage({ type: 'hourtrack:open-reminders' })`; no client →
  `openWindow('/?openReminders=1')`.

In the app, `NotificationBridge` (in `features/reminders/` — `reminders` imports `notifications`, so the reverse edge would be a feature cycle; mounted next to `RemindersScheduler` in `AppLayout`) listens to
`navigator.serviceWorker` messages and consumes the two query params once on start (then strips them
with `history.replaceState`). «Done» runs the existing `useMarkReminderDoneMutation`, so sync and
Calendar clean-up are identical (FR-008); a missing/already-done reminder is a no-op. Opening the list
sets a new `useReminderBellStore` (zustand, like `usePwaUpdate`) that makes `ReminderBell`'s popover
controlled.

**Settings UI.** `NotificationsSection` (in `features/settings/`, placed after `CalendarSection`):
status line per state, «Enable notifications» (off), switch-off + «Send test notification» (on),
blocked hint (site settings → Notifications), not-supported text, and the always-visible limitation
note (FR-010) that names the Calendar popup when Calendar is connected and says nothing covers the
closed app when it is not.

**i18n.** `settings.notifications.*`, `reminders.notification.{title,testTitle,testBody}` in en/uk/es.
Text is resolved via `i18n.t` at post time (current language).

**Release.** 1.11.0: `package.json`, `CHANGELOG_RELEASES` `v1_11_0`, `whatsNew.releases.v1_11_0`, and
the `whatsNew.guide.reminders` items gain the notification line (same count in all locales).

**Lint.** Add an ESLint block for `public/sw-notifications.js` with `globals.serviceworker`.

## Rejected

- `injectManifest` with a TypeScript SW — rewrites the whole SW build for a 40-line click handler.
- Web Push / Periodic Background Sync — out of scope (no backend; spec Assumptions).
- `new Notification()` from the page — throws on Android Chrome; only the SW path works there.

## Risks

- Android freezes backgrounded pages after a few minutes — accepted, stated in UI (FR-010, SC-001).
- SW is disabled in dev, so the posting path is only exercised in `pnpm build && pnpm preview` and on
  the phone; unit tests mock the registration. `sendTest` without a registration shows an error toast.
- Updating to the build with the new SW still goes through the existing «Reload» prompt. Until the
  user accepts it, notifications post through the old SW, whose clicks do nothing (accepted: one
  release window, review finding M4).

## Verification

- Unit: status derivation, prefs, scheduler branching (hidden/visible/on/off/post-throws), stale
  close, bridge messages + query params, SW handler (loaded with a fake `self`/`clients`), section
  states, i18n parity + guide counts.
- Gate: `pnpm lint && pnpm typecheck && pnpm test`.
- Manual on the phone after deploy: enable → test → reminder due in 2 min in background → tap /
  «Done».
