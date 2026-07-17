import type {
  Card,
  DriveSnapshot,
  Entry,
  Payment,
  Reminder,
  Settings,
  Tombstone,
} from '@hourtrack/shared-types';

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
  entityType: 'card' | 'entry' | 'payment' | 'reminder' | 'settings';
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
function mergeSettings(local: Settings, remote: Settings): Settings {
  // S29 (UR-29-4): prefer the side with the newer PREFERENCE stamp
  // (`settingsUpdatedAt`), NOT the whole-file `exportedAt`. Otherwise a
  // device that pushed a stale snapshot with a newer `exportedAt` (e.g. a
  // routine sync bookkeeping write) would silently revert a genuine
  // preference change made on the other device. Missing stamp = epoch (`''`
  // sorts before any ISO timestamp); ties fall back to LOCAL (module
  // convention). Old snapshots without the stamp thus keep the pre-S29
  // behaviour of "local wins on a tie" rather than flipping on exportedAt.
  const localStamp = local.settingsUpdatedAt ?? '';
  const remoteStamp = remote.settingsUpdatedAt ?? '';
  const remoteIsNewer = remoteStamp > localStamp;
  const winningPrefs = remoteIsNewer ? remote : local;

  return {
    language: winningPrefs.language,
    theme: winningPrefs.theme,
    defaultView: winningPrefs.defaultView,
    autoBackupEnabled: winningPrefs.autoBackupEnabled,
    autoBackupIntervalDays: winningPrefs.autoBackupIntervalDays,
    // Carry the newer preference stamp forward so the merged snapshot keeps
    // winning against still-older siblings. `laterIso` handles the missing
    // (undefined) case on either side.
    settingsUpdatedAt: laterIso(local.settingsUpdatedAt, remote.settingsUpdatedAt) ?? undefined,
    // "Later wins" timestamps: NEVER take a stale value over a known one.
    lastBackupAt: laterIso(local.lastBackupAt, remote.lastBackupAt),
    lastSyncAt: laterIso(local.lastSyncAt, remote.lastSyncAt),
    firstLoginAt: laterIso(local.firstLoginAt, remote.firstLoginAt),
    // Device-local bookkeeping — always keep OURS, never overwrite.
    deviceId: local.deviceId,
    driveDataFileId: local.driveDataFileId,
    driveDataEtag: local.driveDataEtag,
    // S31 (UR-31-5): `hourtrackCalendarId` is a DEVICE-RESOLVED cache, not a
    // synced preference — calendar-id writes are excluded from PREFERENCE_KEYS
    // so they don't bump `settingsUpdatedAt`. If it rode `winningPrefs`, a
    // theme toggle on device B (newer stamp, calendarId=null) would null
    // device A's cached id, triggering a redundant `ensureCalendar` and risking
    // a SECOND "HourTrack" calendar. Keep ours; a device that has none
    // re-resolves the same id by name in `ensureCalendar` (idempotent lookup).
    hourtrackCalendarId: local.hourtrackCalendarId,
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
  entityType: 'card' | 'entry' | 'payment' | 'reminder',
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
  // S31 (UR-31-6): `?? []` on cards/entries too (payments/reminders/tombstones
  // were already guarded). A truncated / `null`-array `data.json` pulled from
  // Drive must NOT crash `mergeRows` with a `TypeError` — that would wedge sync
  // (push retries forever / bootstrap fails every boot). `validateSnapshot` on
  // the pull path rejects a malformed snapshot up front; this is belt-and-
  // suspenders for any array that is individually null but shape-valid overall.
  const cards = mergeRows<Card>(
    'card',
    local.cards ?? [],
    remote.cards ?? [],
    tombstoneByEntityId,
    conflicts,
  );
  const entries = mergeRows<Entry>(
    'entry',
    local.entries ?? [],
    remote.entries ?? [],
    tombstoneByEntityId,
    conflicts,
  );
  // S27: payments merge by `updatedAt` LWW exactly like cards/entries; a
  // `payment` tombstone (deletedAt > row.updatedAt) suppresses the row so a
  // delete on device A wins over a stale edit on device B. Payments share the
  // one tombstone store — ids are uuids so there is no cross-entity collision.
  const payments = mergeRows<Payment>(
    'payment',
    local.payments ?? [],
    remote.payments ?? [],
    tombstoneByEntityId,
    conflicts,
  );
  // S28: reminders merge by `updatedAt` LWW exactly like payments; a
  // `reminder` tombstone (deletedAt > row.updatedAt) suppresses the row so a
  // delete on device A wins over a stale edit on device B. Reminders share the
  // one tombstone store — ids are uuids so there is no cross-entity collision.
  const reminders = mergeRows<Reminder>(
    'reminder',
    local.reminders ?? [],
    remote.reminders ?? [],
    tombstoneByEntityId,
    conflicts,
  );

  // Settings conflict detection: shallow per-field compare of the chosen
  // result against local. If any preference field flipped, we attribute it
  // to the remote (the "later wins" timestamps don't count as conflicts).
  const settings = mergeSettings(local.settings, remote.settings);
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
      localUpdatedAt: local.settings.settingsUpdatedAt ?? local.exportedAt,
      remoteUpdatedAt: remote.settings.settingsUpdatedAt ?? remote.exportedAt,
    });
  }

  const exportedAt = local.exportedAt >= remote.exportedAt ? local.exportedAt : remote.exportedAt;
  const merged: DriveSnapshot = {
    // Keep the higher of the two inputs — never silently downgrade a v3
    // snapshot (S21 monthly cards) to v2 after a conflict merge.
    schemaVersion:
      local.schemaVersion >= remote.schemaVersion ? local.schemaVersion : remote.schemaVersion,
    exportedAt,
    deviceId: local.deviceId,
    settings,
    cards: cards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    entries: entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    payments: payments.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    reminders: reminders.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    tombstones,
  };
  return { snapshot: merged, conflictsResolved: conflicts };
}
