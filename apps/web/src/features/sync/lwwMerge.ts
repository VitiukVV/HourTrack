import type { Card, DriveSnapshot, Entry, Settings, Tombstone } from '@hourtrack/shared-types';

/**
 * Pure Last-Write-Wins merge of two snapshots. Inputs are NEVER mutated;
 * the output is a fresh `DriveSnapshot`.
 *
 * Rules (mirror PROJECT_PLAN.md §4 sync flow):
 *
 *   - Per-row LWW by `updatedAt` ISO string compare. Newer wins; ties
 *     fall back to the LOCAL row (consumers always pass local first so
 *     this is deterministic).
 *   - Tombstones express deletes. A tombstone with `deletedAt > row.updatedAt`
 *     (strictly greater) suppresses that row from the merged output. Ties
 *     fall back to the row — same convention as updatedAt ties. Tombstones
 *     older than the surviving row are dropped (the row has been re-created).
 *   - Tombstones older than `tombstoneTtlDays` (default 30) are pruned —
 *     we assume every device has seen them and we no longer need them.
 *   - Settings is merged with a per-field strategy:
 *       * `lastSyncAt` / `lastBackupAt` / `firstLoginAt` -> LATER wins (we
 *          can't drop a known successful sync timestamp by syncing a stale
 *          snapshot)
 *       * `deviceId` is local-only — NEVER overwrite ours with the remote
 *         (the remote's deviceId belongs to a DIFFERENT device)
 *       * `driveDataFileId` / `driveDataEtag` are local-only too —
 *         they're THIS device's bookkeeping for talking to Drive
 *       * All other fields: take from the SNAPSHOT with the newer
 *         `exportedAt` value (i.e. the most-recent snapshot wins for
 *         user preferences)
 *
 * Why local-first for ties: `exportedAt` ties on rapid two-device edits are
 * realistic (clocks drift). Preferring local minimizes UI churn: the user
 * sees their own write reflected, not a phantom revert.
 */

/** Result of merging two snapshots. */
export interface MergeResult {
  /** The merged snapshot, ready to push to Drive. */
  snapshot: DriveSnapshot;
  /** Rows whose remote version replaced our local version. */
  conflictsResolved: ConflictRecord[];
}

export interface ConflictRecord {
  entityType: 'card' | 'entry' | 'settings';
  entityId: string;
  resolution: 'local' | 'remote' | 'tombstone';
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
}

interface MergeOptions {
  tombstoneTtlDays?: number;
  now?: Date;
}

function laterIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a >= b ? a : b;
}

/**
 * Per-field Settings merge. See module-level comment for the rule set.
 * Returns a fresh Settings object.
 *
 * `localExportedAt` and `remoteExportedAt` discriminate "which snapshot is
 * newer" for preference fields without a per-field timestamp.
 */
function mergeSettings(
  local: Settings,
  remote: Settings,
  localExportedAt: string,
  remoteExportedAt: string,
): Settings {
  const remoteIsNewer = remoteExportedAt > localExportedAt;
  const winningPrefs = remoteIsNewer ? remote : local;

  return {
    language: winningPrefs.language,
    theme: winningPrefs.theme,
    defaultView: winningPrefs.defaultView,
    hourtrackCalendarId: winningPrefs.hourtrackCalendarId,
    autoBackupEnabled: winningPrefs.autoBackupEnabled,
    autoBackupIntervalDays: winningPrefs.autoBackupIntervalDays,
    // "Later wins" timestamps: NEVER take a stale value over a known one.
    lastBackupAt: laterIso(local.lastBackupAt, remote.lastBackupAt),
    lastSyncAt: laterIso(local.lastSyncAt, remote.lastSyncAt),
    firstLoginAt: laterIso(local.firstLoginAt, remote.firstLoginAt),
    // Device-local bookkeeping — always keep OURS, never overwrite.
    deviceId: local.deviceId,
    driveDataFileId: local.driveDataFileId,
    driveDataEtag: local.driveDataEtag,
    // Onboarding dismissal is monotonic — once `true` on either device it
    // stays `true` everywhere. OR-merge avoids the "remote snapshot pre-
    // dates dismissal" edge case where a `winningPrefs` lookup would
    // un-dismiss the tour. The Settings preference fields above can be
    // user-toggled in either direction so they follow the snapshot's
    // newer `exportedAt`; `onboardingSeen` is one-way.
    onboardingSeen: local.onboardingSeen || remote.onboardingSeen,
  };
}

/**
 * Merge two row sets by id, picking the row with the larger `updatedAt`.
 * `tombstoneByEntityId` suppresses any row whose id has a tombstone with
 * `deletedAt >= row.updatedAt`. Returns the surviving rows.
 *
 * `recordConflict` is called for every (id, local, remote) triple where the
 * local row differed and was REPLACED by the remote row. We don't record
 * "local wins" as a conflict — only the user-visible mutations.
 */
function mergeRows<T extends { id: string; updatedAt: string }>(
  entityType: 'card' | 'entry',
  local: T[],
  remote: T[],
  tombstoneByEntityId: Map<string, Tombstone>,
  conflicts: ConflictRecord[],
): T[] {
  const out = new Map<string, T>();
  for (const row of local) out.set(row.id, row);

  for (const row of remote) {
    const existing = out.get(row.id);
    if (!existing) {
      out.set(row.id, row);
      continue;
    }
    // Both sides have a row. Keep the newer `updatedAt`. Tie -> local.
    if (row.updatedAt > existing.updatedAt) {
      out.set(row.id, row);
      conflicts.push({
        entityType,
        entityId: row.id,
        resolution: 'remote',
        localUpdatedAt: existing.updatedAt,
        remoteUpdatedAt: row.updatedAt,
      });
    } else if (row.updatedAt < existing.updatedAt) {
      // Local wins — no change to `out`, no conflict record (silent).
    }
    // else tie: keep local.
  }

  // Apply tombstones: drop any row that has a tombstone with deletedAt
  // STRICTLY > its updatedAt. Tie -> keep the row (ties go to local /
  // re-created, matching the rest of this module's convention). A user
  // restoring an archived card from Settings can write `updatedAt = T` at
  // the same millisecond as an in-flight `deletedAt = T` tombstone — under
  // `>=` the restore would be silently lost on the next merge.
  for (const [id, row] of out) {
    const tomb = tombstoneByEntityId.get(id);
    if (!tomb) continue;
    if (tomb.deletedAt > row.updatedAt) {
      out.delete(id);
      conflicts.push({
        entityType,
        entityId: id,
        resolution: 'tombstone',
        localUpdatedAt: row.updatedAt,
        remoteUpdatedAt: tomb.deletedAt,
      });
    }
  }

  return Array.from(out.values());
}

/**
 * Combine local + remote tombstones, keeping the larger `deletedAt`. Then
 * prune any that are older than `now - tombstoneTtlDays`.
 */
function mergeTombstones(
  local: Tombstone[],
  remote: Tombstone[],
  ttlDays: number,
  now: Date,
): Tombstone[] {
  const cutoffIso = new Date(now.getTime() - ttlDays * 86_400_000).toISOString();
  const out = new Map<string, Tombstone>();
  for (const t of [...local, ...remote]) {
    if (t.deletedAt < cutoffIso) continue; // Already expired.
    const existing = out.get(t.entityId);
    if (!existing || t.deletedAt > existing.deletedAt) {
      out.set(t.entityId, t);
    }
  }
  return Array.from(out.values()).sort((a, b) => a.entityId.localeCompare(b.entityId));
}

/**
 * Merge two snapshots. The first arg is treated as LOCAL (preferred on ties);
 * the second as REMOTE. Returns the merged snapshot + the conflict records.
 *
 * The merged snapshot's `exportedAt` is set to the LATER of the two inputs,
 * and `deviceId` is taken from `local` (since the merge happens on THIS
 * device, the "origin" of the merged write is us).
 */
export function lwwMerge(
  local: DriveSnapshot,
  remote: DriveSnapshot,
  options: MergeOptions = {},
): MergeResult {
  const ttlDays = options.tombstoneTtlDays ?? 30;
  const now = options.now ?? new Date();

  const tombstones = mergeTombstones(local.tombstones ?? [], remote.tombstones ?? [], ttlDays, now);
  const tombstoneByEntityId = new Map(tombstones.map((t) => [t.entityId, t]));

  const conflicts: ConflictRecord[] = [];
  const cards = mergeRows<Card>('card', local.cards, remote.cards, tombstoneByEntityId, conflicts);
  const entries = mergeRows<Entry>(
    'entry',
    local.entries,
    remote.entries,
    tombstoneByEntityId,
    conflicts,
  );

  // Settings conflict detection: shallow per-field compare of the chosen
  // result against local. If any preference field flipped, we attribute it
  // to the remote (the "later wins" timestamps don't count as conflicts).
  const settings = mergeSettings(
    local.settings,
    remote.settings,
    local.exportedAt,
    remote.exportedAt,
  );
  if (
    settings.language !== local.settings.language ||
    settings.theme !== local.settings.theme ||
    settings.defaultView !== local.settings.defaultView ||
    settings.autoBackupEnabled !== local.settings.autoBackupEnabled ||
    settings.autoBackupIntervalDays !== local.settings.autoBackupIntervalDays
  ) {
    conflicts.push({
      entityType: 'settings',
      entityId: 'current',
      resolution: 'remote',
      localUpdatedAt: local.exportedAt,
      remoteUpdatedAt: remote.exportedAt,
    });
  }

  const exportedAt = local.exportedAt >= remote.exportedAt ? local.exportedAt : remote.exportedAt;
  const merged: DriveSnapshot = {
    schemaVersion: 1,
    exportedAt,
    deviceId: local.deviceId,
    settings,
    cards: cards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    entries: entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    tombstones,
  };
  return { snapshot: merged, conflictsResolved: conflicts };
}
