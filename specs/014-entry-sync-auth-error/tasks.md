# Tasks: Expired-sign-in sync errors and the overflowing entry dialog

**Spec**: `spec.md` · **Plan**: `plan.md` · Tests first (TDD), colocated `*.test.ts(x)`.

## Phase 1: Foundational — single-flight renewal

- [x] T001 Write failing tests in `src/lib/google/tokenRefresh.test.ts`: `renewAccessToken` shares one `performRefresh` between two concurrent callers; `allowSilentReauth: false` skips `silentReauth` and returns `'transient'` when Path A fails; on-demand renewal never calls `clearTokens`; `getFreshAccessToken` returns the stored token when valid > 60 s, renews when expiring, falls back to the old token when renewal fails
- [x] T002 Implement `renewAccessToken`, `getFreshAccessToken` and the `allowSilentReauth` option in `src/lib/google/tokenRefresh.ts`; route the timer `tick` through `renewAccessToken`

## Phase 2: User Story 1 — edits sync after the app was in the background (P1)

**Independent test**: expired-but-renewable token → save entry → calendar updated, no error.

- [x] T003 [US1] Write failing tests in `src/features/sync/SyncManager.authRenewal.test.ts`: calendar 401 → renew → op retried and row deleted, entry `synced`; second 401 → row rescheduled, entry `error`; Drive push 401 → renew → retried; 3 queued calendar rows with 401 → exactly one renewal; renewal returns `null` → existing error/backoff path
- [x] T004 [US1] Add `renewAccessToken` option, default `getAccessToken` → `getFreshAccessToken()`, and per-run `renewOnce` + retry-once wrapper around `doPushDataJson` / `dispatchCalendarOp` in `src/features/sync/SyncManager.ts`

## Phase 3: User Story 2 — dialog fits the phone screen (P1)

**Independent test**: entry with a long `syncError` at 390 px → no horizontal scroll.

- [x] T005 [P] [US2] Write failing tests in `src/features/entries/EntryEditor.test.tsx`: sync banner text span has no `truncate`, has `break-words`/`min-w-0`; container is `flex-wrap`; in `src/components/ui/dialog.test.tsx` (create if missing) `DialogContent` has `grid-cols-[minmax(0,1fr)]`
- [x] T006 [US2] Make the banner wrap in `src/features/entries/EntryEditor.tsx` and add `grid-cols-[minmax(0,1fr)]` to the shared `DialogContent` base classes in `src/components/ui/dialog.tsx`

## Phase 4: User Story 3 — localized auth error (P2)

- [x] T007 [P] [US3] Write failing tests in `src/features/entries/syncErrorMessage.test.ts`: `"Calendar API error 401 Unauthorized: …"` and `"Drive API error 401 …"` → `googleCalendar.syncErrorAuth`; other text → `googleCalendar.syncError: <detail>`; `null` → prefix only
- [x] T008 [US3] Implement `src/features/entries/syncErrorMessage.ts` and use it in the banner of `src/features/entries/EntryEditor.tsx`; add `googleCalendar.syncErrorAuth` to `src/locales/{uk,en,es}.json`

## Phase 5: Release & polish

- [x] T009 Bump `package.json` to 1.11.1; add `{ version: '1.11.1', date: '2026-10-30', i18nKey: 'v1_11_1' }` on top of `CHANGELOG_RELEASES` in `src/features/whats-new/changelog.ts`; add `whatsNew.releases.v1_11_1.{title,items}` first in all three locales
- [x] T010 Run `pnpm lint && pnpm typecheck && pnpm test`; commit

## Dependencies

T001 → T002 → T003 → T004. T005–T006 and T007–T008 are independent of Phase 1–2. T009 after all code.
MVP: US1 + US2 (both P1 — the reported bug).
