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
 * - Strict on `schemaVersion`: only literal `1` is accepted. Future v2 files
 *   are rejected with a descriptive error; the restore UI surfaces the
 *   message so the user knows their snapshot is from a newer app build.
 * - Lenient on optional fields (e.g. `tombstones`): old v1 snapshots from
 *   pre-S10 builds didn't carry tombstones and the schema permits `undefined`.
 * - Tolerant of unknown fields: `passthrough()` keeps unknown keys around so
 *   a snapshot written by a newer client with a forward-compatible extension
 *   still validates (we'll ignore the extra fields). The `schemaVersion`
 *   gate is the actual compatibility lock.
 *
 * Error model: `safeParse` is used at the call site so callers receive a
 * `{ success: false, error }` result with a structured zod issue list rather
 * than a thrown exception. The UI flattens these into a single human-readable
 * line.
 *
 * NOTE: We deliberately re-declare the zod shape rather than importing
 * `DriveSnapshot` and refining it — keeping the runtime check explicit
 * documents the on-disk format invariants and surfaces breaking changes when
 * a contributor edits `packages/shared-types/src/snapshot.ts` without also
 * updating this file.
 */

const cardSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    color: z.string(),
    defaultDurationMin: z.number().int().nonnegative(),
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
    schemaVersion: z.literal(1, {
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
  /** Single human-readable error suitable for a toast or modal banner. */
  error: string;
  /** Zod issue list for diagnostics (logs / dev console). */
  issues: z.ZodIssue[];
}

export type SnapshotValidationResult = SnapshotValidationOk | SnapshotValidationFail;

/**
 * Validate an arbitrary JSON value as a `DriveSnapshot`. Returns a discriminated
 * union result. On failure, the first zod issue is surfaced as `error` for
 * direct UI consumption; the full issue list is preserved on `issues`.
 */
export function validateSnapshot(input: unknown): SnapshotValidationResult {
  const parsed = DriveSnapshotSchema.safeParse(input);
  if (parsed.success) {
    // The schema is forward-compatible (`passthrough`), so the parsed result is
    // typed as a superset of `DriveSnapshot`. Cast to the canonical type for
    // downstream consumers; extra fields ride along harmlessly.
    return { ok: true, snapshot: parsed.data as DriveSnapshot };
  }
  const first = parsed.error.issues[0];
  const error = first
    ? `${first.path.length > 0 ? first.path.join('.') + ': ' : ''}${first.message}`
    : 'Invalid snapshot';
  return { ok: false, error, issues: parsed.error.issues };
}
