# Implementation Plan: Expired-sign-in sync errors and the overflowing entry dialog

**Spec**: `specs/014-entry-sync-auth-error/spec.md` · **Branch**: `feature/shopping-list-and-sync-fix`

## Root cause (verified in code)

- `SyncManager`'s default `getAccessToken` returns whatever access token is stored, expired or not.
  Renewal lives only in `startTokenRefresh`'s timer (`lib/google/tokenRefresh.ts`), which a phone
  suspends with the backgrounded PWA. On resume the user's save is flushed before the late timer
  tick → Calendar answers 401 → `calendarOps` stamps `syncStatus: 'error'` with the raw
  `CalendarAuthError` message, and the row is rescheduled with backoff. Nothing renews on a 401.
- `EntryEditor`'s sync banner is a flex row whose text `span` is `truncate` (nowrap). The editor sits
  in `DialogContent`, a CSS `grid` whose implicit column is sized by min-content, so the one-line
  error widens the grid track past `max-w-lg` / the viewport → the whole sheet scrolls sideways.

## Design

**Single-flight renewal** (`lib/google/tokenRefresh.ts`):
- `renewAccessToken({ interactive })` — module-level single-flight wrapper over `performRefresh`:
  concurrent callers share one in-flight promise (FR-003). The timer's `tick` calls it too.
- `performRefresh` gains `allowSilentReauth` (default `true`); the on-demand path passes
  `document.visibilityState === 'visible'`, so a hidden tab never opens the GIS pop-up (edge case).
  Path A (refresh-token grant) needs no pop-up and always runs.
- The on-demand path never calls `clearTokens` — only the timer loop decides sign-out (FR-004).
- `getFreshAccessToken(minValidityMs = 60_000)`: returns the stored token when it is valid for
  longer than the margin; otherwise awaits `renewAccessToken` and returns the renewed token, or the
  old one when renewal did not succeed (the request then fails into the existing retry path).

**SyncManager** (`features/sync/SyncManager.ts`):
- Default `getAccessToken` → `getFreshAccessToken()` (FR-001). New injectable option
  `renewAccessToken?: () => Promise<string | null>` (default: forced single-flight renewal → new
  token or `null`).
- In `flush`, a per-run lazy `renewOnce()` memoises one renewal per run (SC-003). `doPushDataJson`
  and each `dispatchCalendarOp` are wrapped: on `DriveAuthError` / `CalendarAuthError`, call
  `renewOnce()`; if it yields a token, repeat that op once with it (FR-002). Later rows in the run
  use the renewed token. A second auth failure goes through the existing reschedule/backoff path.

**UI** (`features/entries/EntryEditor.tsx`, `components/ui/dialog.tsx`):
- Banner: `flex-wrap`, text span `min-w-0 flex-1 break-words` (no `truncate`), button `shrink-0`
  (FR-005).
- `DialogContent` base classes get `[&>*]:min-w-0` so no grid child can widen any dialog —
  same root cause would bite any other long unbroken text.
- `syncErrorMessage(t, syncError)` (`features/entries/syncErrorMessage.ts`): when the stored text is
  a Calendar/Drive 401 (`/\b401\b/`, which also matches legacy stamped strings), show
  `googleCalendar.syncErrorAuth`; else `googleCalendar.syncError: <detail>` (FR-006). The stored
  `syncError` format is unchanged — no data/snapshot change.

**i18n / release**: `googleCalendar.syncErrorAuth` in uk/en/es; patch 1.11.0 → 1.11.1, «What's new»
`v1_11_1`. Guide unchanged (no new capability).

## Rejected

- Renewing inside each Calendar/Drive call (`lib/google/*`): spreads auth knowledge into the API
  clients and loses the per-run single renewal.
- Storing an error code instead of the message: needs an Entry shape/snapshot change for a display
  concern; regex on the stable `"<API> error 401"` prefix covers new and legacy rows.

## Risks

- `getFreshAccessToken` now adds one Dexie read per flush/enqueue — negligible.
- A renewal that hangs blocks that flush; `performRefresh` already has network timeouts via fetch/GIS.

## Verification

`pnpm lint && pnpm typecheck && pnpm test`. New tests: single-flight (two concurrent callers → one
`performRefresh`), hidden tab skips silent re-auth, SyncManager 401 → renew → retry succeeds,
second 401 → error + reschedule, batch of 3 calendar rows → one renewal, banner wraps (no
`truncate`), auth message localized. Manual: 390 px viewport, entry with a long `syncError` — no
horizontal scroll.
