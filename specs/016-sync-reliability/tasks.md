# Tasks: Reliable sync between devices

**Spec**: `spec.md` · **Plan**: `plan.md` · Tests first (TDD), colocated `*.test.ts(x)`.
One commit per phase.

## Phase 1: Test foundations (MR-001, MR-002)

- [x] T001 Add the throwing global `fetch` guard to `vitest.setup.ts`; find and fix the test that reaches `googleapis.com/drive/v3/files?…pageSize=1000` (candidates: `src/features/backup/BackupSection.test.tsx`, `src/features/backup/RestoreModal.test.tsx`, `src/pages/settings/Settings.test.tsx`) and any other test the guard exposes
- [x] T002 Gates; commit `test: fail unit tests on real network requests`

## Phase 2: US1 + US2 — one sync cycle, session pulls (P1; FR-001..007, FR-011)

- [x] T003 [US2] Make `src/features/sync/fakeDrive.ts` behave like Drive: no `etag` header, `version` in metadata bodies bumped on every write; add the failing two-device cases from plan §Test strategy to `src/features/sync/syncEngine.e2e.test.ts`
- [x] T004 [US2] `src/lib/google/drive.ts`: `version` in fields and types; remove etag reads, follow-up meta calls, `ifMatchEtag`, `DriveEtagMismatchError`; update `src/lib/google/drive.test.ts`
- [x] T005 [US1] `src/lib/sync/snapshotFingerprint.ts` (+ test): `(id, updatedAt)` fingerprint over all six row stores + tombstones
- [x] T006 [US2] `src/features/sync/SyncManager.ts`: `syncCycle` + `pullNow()` per plan §2; rewrite the 412 tests in `SyncManager.conflict.test.ts` / `SyncManager.test.ts` / `SyncManager.robustness.test.ts`; extend `SyncManager.authRenewal.test.ts` to `pullNow`
- [x] T007 [US1] `src/features/sync/bootstrap.ts` → thin wrapper over `pullNow()`; update `bootstrap.test.ts`
- [x] T008 [US1] `src/features/sync/sessionPull.ts` (+ test) and wire it in `src/app/providers/SyncOrchestrator.tsx` (+ test) per plan §4
- [x] T009 Update `e2e/fixtures/mockGoogle.ts` (no etag, `version`); document `Settings.driveDataEtag` as the revision token in `src/shared/types/settings.ts`
- [x] T010 Release: `package.json` 1.12.1; `{ version: '1.12.1', date: '2026-11-12', i18nKey: 'v1_12_1' }` on top of `CHANGELOG_RELEASES`; `whatsNew.releases.v1_12_1` first in `src/locales/{uk,en,es}.json`
- [x] T011 Gates; commit `feat(sync): pull before push, session pulls, no ETag dependence (1.12.1)`

## Phase 3: US3 — newer-format guard (P2; FR-008)

- [x] T012 [US3] Failing tests: `validateSnapshot.test.ts` (`RemoteSchemaNewerError`), `syncEngine.e2e.test.ts` (newer remote → zero writes, rows stay queued, status code), `syncErrorMessage.test.ts` (code → `sync.updateRequired`)
- [x] T013 [US3] Implement per plan §3 in `src/lib/sync/validateSnapshot.ts`, `SyncManager.ts`, `syncErrorMessage.ts`, `SyncOrchestrator.tsx`, `src/features/pwa/updatePrompt.ts`; add `sync.updateRequired` to the three locales
- [x] T014 Gates; commit `feat(sync): stop uploading over a newer-format file`

## Phase 4: US2 — durable enqueue (FR-009)

- [x] T015 [US2] Failing test in `SyncManager.test.ts`: `enqueue` writes the row without calling `getAccessToken`; signed out → nothing written
- [x] T016 [US2] `isSignedIn` option in `SyncManager.enqueue`
- [x] T017 Gates; commit `fix(sync): queue a change without waiting for a sign-in renewal`

## Phase 5: US4 — fresh token for backups and re-sync (P2; FR-010)

- [x] T018 [US4] `src/lib/google/authorizedCall.ts` + `authorizedCall.test.ts`
- [x] T019 [US4] Use it in `useBackupsList.ts`, `BackupSection.tsx`, `RestoreModal.tsx`, `AutoBackupScheduler.tsx`, `src/features/calendar-sync/ResyncModal.tsx`; adjust their tests
- [x] T020 Gates; commit `fix(backup): renew the sign-in for backups and calendar re-sync`

## Phase 6: Maintenance (MR-003)

- [x] T021 [P] Stale comments: `validateSnapshot.ts`, `backupService.ts`, `snapshot.ts`, `schema.ts`
- [x] T022 [P] `.github/workflows/ci.yml`: single test run (coverage before build)
- [x] T023 [P] `vite.config.ts`: drop `orientation: 'portrait'`; `git mv IMPROVEMENTS_FROM_MY_DIARY.md docs/archive/`
- [x] T024 Gates; commit `chore: audit hygiene`

## Phase 7: Final verification

- [ ] T025 `pnpm test:coverage` (thresholds) and `pnpm exec playwright test --project=chromium`

## Phase R: Review fixes

Findings of three independent reviews of `git diff main...HEAD`, each verified against the code
before fixing; tests first.

- [x] T026 A1 `restoreFlow.ts`: `pullNow()` before the destructive apply; a pull that does not succeed fails the restore untouched (`remoteCheckFailed`, `backup.restoreSyncCheckFailed`); test: remote changed after the last sync → Drive holds exactly the backup
- [x] T027 A2 `pullNow({ force })`; `sessionPull` forces every pull until the session's first success; `enqueue` comment; two-device test (signed-out edit, unchanged remote)
- [x] T028 A3 `snapshotFingerprint.ts` compares `settings.settingsUpdatedAt`
- [x] T029 A4 `updateJsonFile` = one multipart PATCH (content + `appProperties`); `fakeDrive.ts`, `e2e/fixtures/mockGoogle.ts`, `drive.test.ts`
- [x] T030 A5 `findFile` `orderBy=createdTime`; the fake honours it (no order promised without it)
- [x] T031 A6 `SyncManager.pullError` → status `'error'` until a cycle succeeds; `sync.pullFailed` toast once per session after 3 failures; the indicator click also pulls
- [x] T032 A7 `DriveNetworkError`; unexpected pull failures → `console.error`, `unexpected: true`, toast at once
- [x] T033 A8 `checkForUpdate` remembers a request made before the SW registration; the update-required toast gets a Reload action (`applyUpdateOrReload`)
- [x] T034 A9 missing tests: guards after reload, race heals, failed upload inside `pullNow`, Drive without `version`, exact revision in SC-002, FR-006 payments/reminders, strict `q` + a backup in the two-device world
- [x] T035 Gates; commit `fix(sync): review findings — …`

## Dependencies

T001 → everything. T003 → T004 → T006 → T007 → T008. T005 before T006. Phase 3 and 4 after
Phase 2 (same file). Phase 5 and 6 independent of 3–4.
MVP: Phase 2.
