# Tasks: System notifications for reminders (Android PWA)

**Spec**: `spec.md` · **Plan**: `plan.md` · Tests first in every task (TDD).

## Batch A — foundation (US1, US2)

- [x] T001 `src/features/notifications/notificationPrefs.ts` + test: localStorage-backed enabled flag, default off, read/write survive a throwing storage. [FR-003]
- [x] T002 `src/features/notifications/notificationSupport.ts` + test: `getNotificationStatus` for unsupported / off / on / blocked, incl. granted+pref off and default+pref on. [FR-001]
- [x] T003 `src/features/notifications/showReminderNotification.ts` + test: posts with `tag: reminder:<id>`, `data.reminderId`, «Done» action, text from current language; `closeStaleReminderNotifications` closes only non-open ids; no registration → returns `false`. [FR-004, FR-005, FR-008]

## Batch B — hook + scheduler (US1, US2)

- [x] T004 `src/features/notifications/useNotificationStatus.ts` + test: `enable` prompts only on `default`, sets pref on `granted`, no prompt when already granted, dismissed prompt stays off; `disable`; `sendTest` (error toast without registration); re-read on `visibilitychange`. [FR-002, FR-003, FR-009]
- [x] T005 `RemindersScheduler.tsx` + tests: hidden & on → system notification (no toast); visible → toast only; off/blocked/unsupported → toast as today; post failure → toast; stamp `notifiedAt` once; overdue-at-start not notified; stale notifications closed each tick. [FR-004..006, FR-011]
- [x] T006 `useReminderBellStore` + `ReminderBell` controlled popover + tests (existing bell tests still pass). [FR-007]

## Batch C — click handling (US3)

- [x] T007 `public/sw-notifications.js` + test (loaded with fake `self`/`clients`): close; `done` → postMessage to existing client without focus, else `openWindow('/?reminderDone=<id>')`; body → focus + `open-reminders`, else `openWindow('/?openReminders=1')`. ESLint block with `globals.serviceworker`; `workbox.importScripts` in `vite.config.ts`. [FR-007, FR-008]
- [x] T008 `src/features/reminders/NotificationBridge.tsx` + test: SW messages → mark done (missing/done reminder = no-op) / open bell; query params consumed once and stripped; mounted in `AppLayout`. [FR-007, FR-008]
- [x] T009 `src/features/settings/NotificationsSection.tsx` + test, placed after `CalendarSection`: four states, enable/disable/test, blocked hint, not-supported text, limitation note with Calendar connected vs not. [FR-001, FR-009, FR-010]

## Batch D — i18n + release

- [x] T010 Locale keys are added in en/uk/es by the task that first uses them (T003, T004, T009); T010 = review wording and run the parity test. [FR-012]
- [x] T011 Release 1.11.0: `package.json`, `CHANGELOG_RELEASES` `v1_11_0`, `whatsNew.releases.v1_11_0`, notification line in `whatsNew.guide.reminders.items` ×3 locales. [FR-013]
- [x] T012 Gate `pnpm lint && pnpm typecheck && pnpm test`; `pnpm build` and confirm `dist/sw.js` imports `sw-notifications.js`.

Manual phone check (spec SC-001) is listed in plan Verification; not a gate.
