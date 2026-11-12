# Implementation Plan: Reliable sync between devices

**Spec**: `specs/016-sync-reliability/spec.md` · **Branch**: `feature/sync-reliability`

## Root causes (verified in code, audit 2026-11-12)

- `SyncOrchestrator.tsx` hands `runBootstrap` the stored `tokens.accessToken` as is, once per
  session. Started with an expired token it gets 401 → `outcome: 'failed'` → `console.warn`, and
  `bootstrapRanRef` is already `true`: no pull for the rest of the session.
- `lib/google/drive.ts` reads the revision from the `ETag` response header. Drive v3 has no file
  ETag and does not list it in `Access-Control-Expose-Headers`, so in a browser the value is `''`,
  `If-Match` is never sent, and the 412 → pull + merge branch in `SyncManager.doPushDataJson` is
  dead. `fakeDrive.ts` and `e2e/fixtures/mockGoogle.ts` do send an etag, so tests pass.
- `doPushDataJson` with no cached `driveDataFileId`: `findFile` → `updateJsonFile(local snapshot)`
  — a blind replace of whatever is there.
- Nothing pulls during a session.
- `bootstrap.snapshotsEqual` compares only cards, entries and tombstones.
- Both 404 branches (`bootstrap.ts`, `SyncManager.ts`) call `createJsonFile` without `findFile`.
- `validatePulledSnapshot` rejects `schemaVersion > 8` like any corrupt file; pushes continue.
- `SyncManager.enqueue` awaits `getFreshAccessToken()` (possibly a pop-up renewal) before the queue
  row is written.
- Backup / restore / auto-backup / calendar re-sync read `tokens.accessToken` from React context
  with no renewal and no 401 retry.

## Design

### 1. Remote revision without ETag (`lib/google/drive.ts`)

- Request `version` in every metadata `fields` list (`files.get`, list, create and update replies);
  `DriveFileMeta` / `DriveJsonFile` carry `version: string`. Remove the `etag` header reads, the
  follow-up `readFileMeta` calls that existed only to fetch it, the `ifMatchEtag` parameter and
  `DriveEtagMismatchError` (nothing can raise it any more). After an update that also patches
  `appProperties`, the returned `version` is the one from the LAST request (the patch bumps it).
- The remembered revision lives in the existing device-local `Settings.driveDataEtag` field (now
  documented as «opaque remote revision token — Drive's `version`»). No Dexie or snapshot schema
  change; old stored values (`''`) simply read as «unknown → treat as changed».

### 2. One sync cycle inside `SyncManager` (FR-001..007, FR-011)

`SyncManager.syncCycle(database, token, { push })`, always run under the existing flush lock:

1. Resolve the file: cached id, else `findFile`. None → `createJsonFile(local)`; store id + version.
2. `readFileMeta(fileId)`. `DriveNotFoundError` → clear the cached id, `findFile` again, then
   create only if still none (FR-007).
3. If `meta.version !== settings.driveDataEtag` (or nothing cached): `readJsonFile` → guard newer
   format (§3) → `validatePulledSnapshot` → `lwwMerge(local, remote)` → `recordConflicts` →
   `applySnapshot(merged, { mode: 'merge' })`. Remember `remoteNeedsPush = !sameRows(remote, merged)`
   where `sameRows` fingerprints `(id, updatedAt)` over ALL six row stores + tombstones (moved out
   of `bootstrap.ts` into `lib/sync/snapshotFingerprint.ts`, FR-006).
4. Upload when `push` was requested OR `remoteNeedsPush`: `updateJsonFile(fileId, snapshotToPush)`
   where `snapshotToPush` is the merged snapshot (after a pull) or a fresh `buildSnapshot`.
5. Store `driveDataFileId`, `driveDataEtag = version after the last request`, `lastSyncAt`.
   If no upload happened, store the pulled `meta.version`.

Public surface:
- `flush()` — unchanged contract; `pushDataJson` rows run `syncCycle({ push: true })`.
- `pullNow(): Promise<PullResult>` — runs `syncCycle({ push: false })` under the same lock with the
  same `getAccessToken` (→ `getFreshAccessToken`) and `withAuthRetry` (FR-001). Returns
  `{ outcome: 'created' | 'pulled' | 'unchanged' | 'no-token' | 'no-scope' | 'offline' |
  'update-required' | 'failed', conflictCount, hasCalendarScope, error? }`. Never throws.
- SC-003: unchanged remote → one `files.get` metadata call, no media download.

Accepted race (spec Edge Cases): Drive offers no compare-and-swap, so two uploads inside the
check→upload window can still overwrite; the loser re-merges at its next cycle, which §4 makes
frequent. Not solved further.

`bootstrap.ts` shrinks to a thin `runBootstrap()` → `getSyncManager().pullNow()` mapping (kept so
the orchestrator's toasts and existing callers keep one entry point); its own Drive calls,
`snapshotsEqual` and the token parameters go away.

### 3. Newer-format guard (FR-008)

- `lib/sync/validateSnapshot.ts`: export `SUPPORTED_SNAPSHOT_VERSION_MAX` and
  `RemoteSchemaNewerError` (thrown by `validatePulledSnapshot` when the raw `schemaVersion` is a
  number above the max — checked before zod).
- `SyncManager`: on that error set `updateRequired = true`, status `'error'` with the stable code
  string `SYNC_UPDATE_REQUIRED` as `lastError`; while set, `runFlushOnce` skips `pushDataJson` rows
  (left queued, not rescheduled, no retry timer) but still runs calendar ops. A later cycle that
  reads a supported file clears the flag — in practice that is after the app update reloads.
- UI: `syncErrorDetail` maps the code to `sync.updateRequired` (uk/en/es) for the indicator
  tooltip; `SyncOrchestrator` shows one persistent `toast.error` for outcome `update-required` and
  asks the service worker to check for an update (`features/pwa/updatePrompt` — use its existing
  registration handle; add a tiny `checkForUpdate()` export if none exists).

### 4. Session pulls (`app/providers/SyncOrchestrator.tsx`, FR-002/003)

- On session start: `pullNow()`. On `visibilitychange → visible` and `online`: `pullNow()` unless
  the last SUCCESSFUL pull was < `PULL_MIN_INTERVAL_MS` (120 000) ago.
- A failed pull (`failed`) arms a retry with `nextRetryDelay(failures)` (2 s … 60 s cap); it is
  skipped while hidden/offline — the visibility/online trigger takes over.
- `no-token` / `no-scope` / `update-required` do not arm a retry.
- Toasts as today (`no-scope`, missing calendar scope) shown once per session.
- Logic lives in a small non-React `features/sync/sessionPull.ts` (`startSessionPull({ onResult })
  → dispose`) so it is unit-testable without rendering; the component only starts/stops it.

### 5. Durable enqueue (FR-009)

`SyncManager.enqueue` gates on a new `isSignedIn` option (default: `getTokens() !== null`) instead
of `getAccessToken()`. `getAccessToken` is still used by `flush`.

### 6. Fresh token for one-off Google calls (FR-010)

`lib/google/authorizedCall.ts`: `withFreshToken(call)` — `getFreshAccessToken()` → `call(token)`;
on `DriveAuthError` / `CalendarAuthError` → `forceRenewAccessToken()` → repeat once; no token →
throws a typed `NotSignedInError`. Used by `useBackupsList`, `BackupSection` (create),
`RestoreModal` / `restoreFlow`, `AutoBackupScheduler` / `autoBackup`, `ResyncModal`. Services keep
their `accessToken` parameter (tests inject it); only the callers change.

### 7. Maintenance (MR-001..003)

- `vitest.setup.ts`: `globalThis.fetch` replaced by a function that throws
  `Unexpected network request in a unit test: <url>`; find and fix the test that reaches
  `drive/v3/files?…pageSize=1000` (one of `BackupSection.test.tsx`, `RestoreModal.test.tsx`,
  `pages/settings/Settings.test.tsx`).
- `fakeDrive.ts` and `e2e/fixtures/mockGoogle.ts`: no `etag` header, `version` in metadata bodies,
  bumped on every write (including the appProperties patch).
- Comments: `validateSnapshot.ts` header + `versionMismatch` doc, `backupService.ts` «currently
  v2», `snapshot.ts` «Strip device-local bookkeeping», `schema.ts` `AuthTokensRow` «PKCE session».
- CI: drop the separate `Test` step; `Coverage` (which runs the same tests) moves before `Build`.
- `vite.config.ts` manifest: remove `orientation: 'portrait'`.
- `git mv IMPROVEMENTS_FROM_MY_DIARY.md docs/archive/`.

### Release

Patch 1.12.0 → 1.12.1, `v1_12_1` in `changelog.ts` and the three locales (user wording only: sync
between devices is more reliable; changes from another device appear when you return to the app;
backups work after a long idle). Guide block unchanged.

## Trade-offs already decided (do not re-propose)

- Reuse `Settings.driveDataEtag` for the revision token rather than add/rename a field.
- No `If-Match`; the near-simultaneous-upload window is accepted.
- `runBootstrap` stays as a thin wrapper rather than being deleted.
- Version check before download (two requests on change) rather than always downloading.

## Test strategy

- `syncEngine.e2e.test.ts` (two devices on the etag-less `FakeDrive`): B uploads, A — which has not
  pulled — uploads a different row → Drive and A hold both (SC-002; fails on current code);
  unchanged remote → no media read (SC-003); no cached id + existing remote → merged, not replaced;
  remote 404 with a second device → one file; newer-format remote → zero writes; differences only
  in payments / reminders / monthAdjustments / shoppingItems are uploaded by `pullNow`.
- `SyncManager.*.test.ts`: the 412 tests are rewritten against the version check; auth-renewal
  tests extended to `pullNow`; enqueue does not call `getAccessToken`.
- `sessionPull.test.ts`: throttle, retry after failure, visibility/online triggers, dispose.
- `authorizedCall.test.ts`; adjusted backup / resync component tests.
- Gates: `pnpm lint && pnpm typecheck && pnpm test`; once at the end `pnpm test:coverage` and
  `pnpm exec playwright test --project=chromium` (CI runs both).

## Risks

- Large rewrite of `SyncManager.doPushDataJson` and its tests — mitigated by the two-device suite.
- `mockGoogle.ts` drives the Playwright suite — must be updated in the same commit as `drive.ts`.
- Drive `version` semantics are an assumption (spec); if a live check shows it is not returned for
  appDataFolder files, fall back to `md5Checksum` + `modifiedTime` behind the same token field.
