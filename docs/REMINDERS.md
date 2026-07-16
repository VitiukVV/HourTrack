# Reminders (S28)

Dated, free-text reminders the user sets for themselves — e.g.
_"4 серпня 09:00 — Забрати кошти в Марі за липень"_.

## Delivery surfaces (and why there are only two)

A reminder is surfaced in exactly two places:

1. **In-app** — a due-reminders **banner** on app open (persists across opens
   until marked Done), a header **bell** with a badge counting due, not-done
   reminders, and a **toast** if the app happens to be open at the moment a
   reminder comes due (fires once per reminder, guarded by `notifiedAt`).
2. **A Google Calendar event** at the due date/time, created through the app's
   existing Calendar sync queue (`buildReminderEvent` → `createReminderEvent`
   op). The event carries a single `popup` notification override — that is
   **free upside** if the user's Calendar app chooses to notify; HourTrack does
   NOT verify or depend on it, and its absence is NOT a bug.

## Why no phone-shade / push notification?

The original ask (2026-07-12) included a native notification at the due time
**with the app closed**. The scope was **narrowed the same day** by the user:

> "нотифікація в шторці не потрібна — буде достатньо тієї яка буде в додатку і
> в гугл календарі."

The reasons this is the right call for HourTrack specifically:

- **There is no server.** HourTrack is a fully client-side PWA (Dexie + Google
  Drive/Calendar). Web Push requires a push service **and a backend** to hold
  subscriptions and send messages — infrastructure this app deliberately does
  not have.
- **The client-only scheduled-notification API is dead.** The
  Notification Triggers API (`showTrigger` / `TimestampTrigger`) never shipped
  beyond an origin trial and was removed; there is no reliable way to schedule
  a local notification to fire while the tab/app is closed.
- **The Google Calendar event already covers the "closed app" case.** The user
  gets whatever notification their Calendar app provides from the HourTrack
  calendar — for free, with no push infrastructure.

So the **complete delivery story is in-app + Calendar event**. Do NOT add the
Notification API, permission prompts, `injectManifest`/service-worker changes,
Web Push, or a push backend — that is exactly the scope this revision removed.

## Data model

`Reminder` (`packages/shared-types/src/reminder.ts`): `{ id, text, dueDate
('YYYY-MM-DD' local), dueMinutes (0..1439), doneAt, googleEventId, syncStatus,
syncError, notifiedAt, createdAt, updatedAt }`. Same local-date +
minutes-since-midnight conventions as `Entry`. Dexie **v8** (`reminders` store),
Drive snapshot **v5** (`reminders: Reminder[]`), reminder deletes ride the
shared `tombstones` store with `entityType: 'reminder'`.

## Calendar sync rules

- **Create** → `createReminderEvent` (skipped if the reminder is already done —
  prevents resurrecting a dismissed reminder whose create hadn't drained yet).
- **Edit** (text/date/time) → `updateReminderEvent` (PATCH if a `googleEventId`
  exists, else create).
- **Done or delete** → `deleteReminderEvent` **when the due time is still in the
  future** — a collected-early reminder must NOT leave a stale event that pings
  later. A past-due done needs no Calendar call. Explicit delete always removes
  the event (no orphans). All ops ride the same retryable sync queue, so an
  offline done/delete is safe.

## Deliberately out of scope

No recurring reminders, no snooze, no reminder→payment hard link (the Payments
"Нагадати" quick-create is **prefill only**), no reminder categories. Recurring
and snooze are the likely first future asks.
