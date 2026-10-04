# Implementation Plan: Data layer split into repositories

**Branch**: `feature/architecture-refactor` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary

Cut `lib/db/queries.ts` along its existing section headers into `lib/db/repos/*.ts`, extract the
repeated write patterns into `lib/db/mutate.ts`, keep `queries.ts` as `export *` barrel, and
route the two bypasses (calendar-disconnect reset, local tombstone prune) through repositories.

## Technical Context

**Language/Version**: TypeScript 6, Dexie 4
**Testing**: existing `lib/db/*.test.ts` (atomicity, card order, cascade delete, settings write,
sync queue/tombstones) are the regression net — they import from `./queries` and must pass as is.
**Constraints**: identical transaction scopes and error messages (FR-005).

## Constitution Check

Template — no gates. Internal change, no version bump. Pass.

## Design

```text
lib/db/
  mutate.ts          nowIso(); patchRow(table, id, patch, label, validate?) — get→merge→stamp→
                     validate→put inside one rw transaction; deleteWithTombstone(db, table,
                     entityType, id) — get→delete→tombstone in one rw transaction, returns row|null
  repos/settings.ts  defaultSettings, initDB, getSettings, updateSettings
  repos/cards.ts     assertCardShape, reads, getCardsOrdered*, create/update/archive/restore/delete
  repos/cardOrder.ts comparator, nextCardPosition, reorderCard (no import back into cards.ts)
  repos/entries.ts   reads, create/update/delete, + resetCalendarSyncFields (FR-003)
  repos/payments.ts  reads, create/update/delete
  repos/reminders.ts isReminderDue, reads, create/update/delete
  repos/syncQueue.ts enqueue/get/delete/reschedule
  repos/tombstones.ts write/getAll/clear/pruneOldTombstones(db, keepDays = TOMBSTONE_TTL_DAYS)
  queries.ts         `export * from './repos/…'` barrel (index.ts unchanged)
lib/sync/retention.ts  ← features/sync/retention.ts (lib may not import features; FR-004 needs
                       the constant in lib). features/sync/pruneTombstones.ts is deleted; boot
                       (`main.tsx`) and SyncManager both call `pruneOldTombstones(db)`.
```

- `updateCard` keeps its own body: its conditional shape assertion and the `position` check do
  not fit `patchRow`'s single `validate` hook without obscuring the S31/legacy-row comments.
  `updateEntry/Payment/Reminder` use `patchRow`; `deleteEntry/Payment/Reminder` use
  `deleteWithTombstone` (deleteEntry maps the returned row to its `Pick<…>` shape).
- Error messages stay byte-identical: `patchRow` takes the label (`updateEntry: entry not found`).
- `pruneTombstones.test.ts` moves next to the repo (`lib/db/pruneTombstones.test.ts`) and calls
  `pruneOldTombstones`.

## Complexity Tracking

None.
