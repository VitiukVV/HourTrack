import type { Card } from './card';
import type { Entry } from './entry';
import type { Payment } from './payment';
import type { Reminder } from './reminder';
import type { Settings } from './settings';
import type { Tombstone } from './tombstone';

/**
 * DriveSnapshot -- the on-disk shape of `data.json` (and every file under
 * `backups/`) stored in the user's Google Drive App Folder.
 *
 * Mirrors PROJECT_PLAN.md §7.1 verbatim. Bump `schemaVersion` (and write a
 * migration before consuming older snapshots) on ANY breaking change to
 * `Card`, `Entry`, or `Settings`.
 *
 * `tombstones` carries deletes that haven't been propagated to all devices
 * yet. Pruned after 30 days by `features/sync/lwwMerge.ts`.
 *
 * Changelog:
 *   v1 (S02) -- initial format.
 *   v2 (S16) -- adds `startMinutes` to Entry and `defaultStartMinutes` to
 *               Card to support time-of-day tracking. Per V2_FEATURE_PLAN
 *               decision #2 the migration is destructive: v1 snapshots are
 *               rejected by `validateSnapshot` (no backward-compat path),
 *               and the local Dexie store is wiped on the v4 -> v5 upgrade.
 *   v3 (S21) -- adds `monthlyTotal: number | null` to Card and `'monthly'`
 *               to the `rateType` discriminator. NON-destructive: v2
 *               snapshots are still importable via the explicit v2->v3
 *               restore branch in `validateSnapshot` + `restoreFlow` (every
 *               card is backfilled with `monthlyTotal: null`).
 *   v4 (S27) -- adds the `payments: Payment[]` store (per-card monthly
 *               paid/not-paid ledger). NON-destructive and forward-only: v2
 *               and v3 snapshots are still importable — the in-band upgrade in
 *               `validateSnapshot` (+ `restoreFlow`) backfills `payments: []`.
 *               A payment delete rides the shared tombstone store with
 *               `entityType: 'payment'`.
 *   v5 (S28) -- adds the `reminders: Reminder[]` store (dated in-app +
 *               Calendar reminders). NON-destructive and forward-only: v2/v3/v4
 *               snapshots are still importable — the in-band upgrade in
 *               `validateSnapshot` (+ `restoreFlow`) backfills `reminders: []`.
 *               A reminder delete rides the shared tombstone store with
 *               `entityType: 'reminder'`.
 */
export interface DriveSnapshot {
  /** Format version. Currently `5` (bumped in S28). */
  schemaVersion: 2 | 3 | 4 | 5;
  /** ISO timestamp at the moment of export. */
  exportedAt: string;
  /**
   * Stable identifier for the originating device. Used by SyncManager (S10)
   * to detect "remote vs local origin" and resolve LWW conflicts.
   */
  deviceId: string;
  settings: Settings;
  /** ALL cards including archived ones (for cross-device restore parity). */
  cards: Card[];
  entries: Entry[];
  /**
   * S27 — recorded payments (the "received" side of the Payments ledger).
   * Optional in reads for backwards-compatibility with v2/v3 snapshots that
   * predate the field — writers always emit `[]` at minimum, and the
   * v2/v3->v4 restore backfill injects `[]` when missing.
   */
  payments?: Payment[];
  /**
   * S28 — dated reminders (in-app banner/toast + Google Calendar event).
   * Optional in reads for backwards-compatibility with v2/v3/v4 snapshots that
   * predate the field — writers always emit `[]` at minimum, and the
   * v2/v3/v4->v5 restore backfill injects `[]` when missing.
   */
  reminders?: Reminder[];
  /**
   * Deletes recorded on any device that may not have propagated yet. Optional
   * in v1 reads for backwards-compatibility with the empty pre-S10 snapshots
   * — writers always emit `[]` at minimum.
   */
  tombstones?: Tombstone[];
}
