import { z } from 'zod';

import type { DriveSnapshot } from '@hourtrack/shared-types';

/**
 * Zod runtime validator for `DriveSnapshot`.
 *
 * Restore is destructive — we wipe local Dexie state and re-hydrate from the
 * snapshot. A malformed file (corrupted upload, wrong schemaVersion, future
 * shape we don't know how to read) MUST be rejected BEFORE the wipe. This
 * module is the gate.
 *
 * Design:
 * - Strict on `schemaVersion`: only literal `2` is accepted (bumped in S16
 *   for time-bound tracking). v1 snapshots — produced by builds before S16 —
 *   are rejected with the `versionMismatch` code so the Restore modal can
 *   surface a friendly "this backup is from an older app version" message.
 *   Per V2_FEATURE_PLAN decision #2 there is NO backward-compat path; the
 *   user re-enters their data.
 * - For v2 snapshots that pass the version gate, every card MUST have a
 *   valid `defaultStartMinutes` and every entry MUST have a valid
 *   `startMinutes` (both integers in `[0, 1439]`). Missing/invalid values
 *   surface the `missingTimeField` code — distinct from `versionMismatch`
 *   so the UI can render a different message ("snapshot is corrupted / from
 *   an unrecognised v2 build").
 * - Lenient on optional fields (e.g. `tombstones`).
 * - Tolerant of unknown fields: `passthrough()` keeps unknown keys around
 *   so a snapshot written by a newer client with a forward-compatible
 *   extension still validates (extras are ignored).
 *
 * Error model: `safeParse` is used so callers receive a discriminated
 * union result rather than a thrown exception. The UI flattens issues into
 * a single human-readable line + reads `code` for branching copy.
 *
 * NOTE: We deliberately re-declare the zod shape rather than importing
 * `DriveSnapshot` and refining it — keeping the runtime check explicit
 * documents the on-disk format invariants and surfaces breaking changes
 * when a contributor edits `packages/shared-types/src/snapshot.ts` without
 * also updating this file.
 */

/**
 * Stable, machine-readable error codes that the Restore modal branches on
 * to render the right friendly copy. Add new codes as new validation
 * branches are introduced; never change the spelling of an existing one.
 */
export type SnapshotValidationErrorCode =
  /** `schemaVersion` is not `2` — old or unknown app version. */
  | 'versionMismatch'
  /** A v2 entry is missing `startMinutes` or a card is missing
   *  `defaultStartMinutes`. Indicates a corrupt or hand-edited file. */
  | 'missingTimeField'
  /** Any other zod parse failure (date format, enum, shape, etc.). */
  | 'malformed';

const cardSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    color: z.string(),
    defaultDurationMin: z.number().int().nonnegative(),
    /**
     * S16: required since v2. The `missingTimeField` branch below verifies
     * this AFTER the version gate so v1 inputs fail with `versionMismatch`
     * instead of leaking a confusing "missingTimeField" message.
     */
    defaultStartMinutes: z.number().int().min(0).max(1439),
    rateType: z.enum(['hourly', 'fixed']),
    hourlyRate: z.number().nullable(),
    fixedTotal: z.number().nullable(),
    defaultNote: z.string().nullable(),
    isArchived: z.boolean(),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const entrySchema = z
  .object({
    id: z.string().min(1),
    cardId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'entry.date must be YYYY-MM-DD',
    }),
    /** S16: required since v2. See note on `cardSchema.defaultStartMinutes`. */
    startMinutes: z.number().int().min(0).max(1439),
    durationMin: z.number().int().nonnegative(),
    useCustomPayment: z.boolean(),
    customPayment: z.number().nullable(),
    note: z.string().nullable(),
    googleEventId: z.string().nullable(),
    syncStatus: z.enum(['pending', 'synced', 'error']),
    syncError: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const settingsSchema = z
  .object({
    language: z.enum(['uk', 'en', 'es']),
    theme: z.enum(['system', 'light', 'dark']),
    defaultView: z.enum(['month', 'week']),
    hourtrackCalendarId: z.string().nullable(),
    autoBackupEnabled: z.boolean(),
    autoBackupIntervalDays: z.number().int().min(1).max(30),
    lastBackupAt: z.string().nullable(),
    lastSyncAt: z.string().nullable(),
    firstLoginAt: z.string().nullable(),
    deviceId: z.string().nullable(),
    driveDataFileId: z.string().nullable(),
    driveDataEtag: z.string().nullable(),
    // S13: optional because pre-S13 snapshots predate the field. Default
    // `false` filled by `applySnapshot` when the snapshot omits it (so the
    // onboarding gate can still fire on restore from an old backup).
    onboardingSeen: z.boolean().optional(),
  })
  .passthrough();

const tombstoneSchema = z
  .object({
    entityId: z.string().min(1),
    entityType: z.enum(['card', 'entry']),
    deletedAt: z.string(),
  })
  .passthrough();

export const DriveSnapshotSchema = z
  .object({
    schemaVersion: z.literal(2, {
      errorMap: () => ({
        message:
          'Unsupported snapshot schemaVersion. This backup was created by a different app version.',
      }),
    }),
    exportedAt: z.string().min(1, 'exportedAt is required'),
    deviceId: z.string().min(1, 'deviceId is required'),
    settings: settingsSchema,
    cards: z.array(cardSchema),
    entries: z.array(entrySchema),
    tombstones: z.array(tombstoneSchema).optional(),
  })
  .passthrough();

export interface SnapshotValidationOk {
  ok: true;
  snapshot: DriveSnapshot;
}

export interface SnapshotValidationFail {
  ok: false;
  /** Stable error code for UI branching. See `SnapshotValidationErrorCode`. */
  code: SnapshotValidationErrorCode;
  /** Single human-readable error suitable for a toast or modal banner. */
  error: string;
  /** Zod issue list for diagnostics (logs / dev console). */
  issues: z.ZodIssue[];
}

export type SnapshotValidationResult = SnapshotValidationOk | SnapshotValidationFail;

/**
 * Pre-check the inbound value's `schemaVersion` BEFORE running the full
 * zod parse. This gives `versionMismatch` priority over any other zod
 * issue — without this guard, a v1 snapshot (which is also missing
 * `startMinutes` / `defaultStartMinutes`) would surface as
 * `missingTimeField`, which is confusing for the user. The v1 case is the
 * actionable "your backup is from an older app version" branch; surface
 * that copy first.
 */
function readSchemaVersion(input: unknown): number | undefined {
  if (input !== null && typeof input === 'object' && 'schemaVersion' in input) {
    const v = (input as { schemaVersion: unknown }).schemaVersion;
    return typeof v === 'number' ? v : undefined;
  }
  return undefined;
}

/**
 * Validate an arbitrary JSON value as a `DriveSnapshot`. Returns a
 * discriminated union result; on failure, `code` lets the UI render
 * targeted copy and `error` carries a single line suitable for a toast.
 */
export function validateSnapshot(input: unknown): SnapshotValidationResult {
  // Step 1: hard-fail anything that isn't a v2 snapshot. We surface
  // `versionMismatch` even before zod parsing because a v1 snapshot would
  // ALSO fail the `startMinutes`/`defaultStartMinutes` shape checks below,
  // and `missingTimeField` would be the wrong story for the user.
  const version = readSchemaVersion(input);
  if (version !== 2) {
    return {
      ok: false,
      code: 'versionMismatch',
      error:
        'Unsupported snapshot schemaVersion. This backup was created by a different app version.',
      issues: [],
    };
  }

  // Step 2: full zod parse.
  const parsed = DriveSnapshotSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, snapshot: parsed.data as DriveSnapshot };
  }

  // Step 3: classify the failure. Any zod issue whose path lands on
  // `startMinutes` (entries) or `defaultStartMinutes` (cards) is a
  // missing-time-field problem; everything else is `malformed`.
  const isTimeFieldIssue = parsed.error.issues.some((iss) => {
    const path = iss.path.map(String);
    return path.includes('startMinutes') || path.includes('defaultStartMinutes');
  });
  const first = parsed.error.issues[0];
  const error = first
    ? `${first.path.length > 0 ? first.path.join('.') + ': ' : ''}${first.message}`
    : 'Invalid snapshot';
  return {
    ok: false,
    code: isTimeFieldIssue ? 'missingTimeField' : 'malformed',
    error,
    issues: parsed.error.issues,
  };
}
