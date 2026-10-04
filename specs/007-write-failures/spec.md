# Spec 007: Write failures are never silent

**Audit**: `docs/audit/2026-10-04-architecture-audit.md` step 6 (A7) · **Branch**: `feature/architecture-refactor`

## Context

A failed write (a Dexie error, a full disk, a broken migration) today often leaves no trace for
the user: a theme or backup toggle simply does not change, a restore button does nothing, a
voided `mutateAsync` becomes an unhandled rejection in the console. Disconnecting Google Calendar
runs two separate writes, so a failure between them leaves the calendar "disconnected" with
entries still marked synced. Two read-error states mislead: the day picker shows "Loading…"
forever, and the entry editor says the entry was deleted.

## Clarifications (decided by the implementer — owner asked to run all steps to the end)

- The settings write toasts from the hook (one place), not from each section.
- A failed sync bootstrap stays console-only: an offline launch fails it routinely, so a toast
  on every such launch would be noise. Out of scope.
- The 14 `catch` blocks with a comment were reviewed; each documents why it swallows (listener
  isolation, best-effort rotation, fallback paths). No change.
- User-visible → patch bump 1.7.0 → 1.7.1 and a «What's new» entry in 3 locales.

## Requirements

- **FR-001**: `useUpdateSettingsMutation` logs and toasts `common.saveFailed` on error; callers
  that toasted on their own (LanguageSwitcher) stop doing so.
- **FR-002**: Calendar disconnect is one transaction (`disconnectCalendar` in `lib/db/repos`):
  either the calendar id is cleared AND every entry's sync fields reset, or nothing changes.
- **FR-003**: No `void x.mutateAsync(...)` in app code — ESLint `no-restricted-syntax` rejects it;
  existing sites move to `mutate` (errors reach the hook's `onError`).
- **FR-004**: A global `unhandledrejection` listener logs and toasts `common.unexpectedError` as
  the last safety net (aborts excluded).
- **FR-005**: The scheduler's "done" toast action reports failure (`reminders.actionFailed`) like
  the banner and bell do; a failed `notifiedAt` stamp is logged.
- **FR-006**: The day picker shows `common.loadFailed` on a cards read error; the entry editor
  shows `common.loadFailed` instead of "deleted" when the entry read fails.

## Success Criteria

- **SC-001**: `grep -rn "void [a-zA-Z.]*mutateAsync"` in `src` (non-test) → 0; the lint rule has a
  regression row in `layerBoundaries.test.ts`.
- **SC-002**: Tests prove FR-001, FR-002 (failure mid-disconnect leaves both untouched), FR-004,
  FR-005, FR-006.
- **SC-003**: gate + build pass; `pnpm e2e` passes; i18n parity test passes.
