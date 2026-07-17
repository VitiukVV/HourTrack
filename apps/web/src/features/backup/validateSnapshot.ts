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
 * - Accepts schemaVersion 2 (S16), 3 (S21), 4 (S27), or 5 (S28). v3 added
 *   `'monthly'` to `rateType` and a `monthlyTotal: number | null` field on
 *   Card; v4 added the `payments: Payment[]` store; v5 added the
 *   `reminders: Reminder[]` store. Older snapshots are upgraded in-band and
 *   forward-only: every card has `monthlyTotal: null` backfilled, a missing
 *   `payments` array is backfilled to `[]`, and a missing `reminders` array is
 *   backfilled to `[]` before zod validates, and the discriminator union
 *   tolerates the legacy 'hourly' / 'fixed' shape. v1
 *   snapshots (pre-S16) are rejected with the `versionMismatch` code so the
 *   Restore modal can surface a friendly "this backup is from an older app
 *   version" message. Per V2_FEATURE_PLAN decision #2 there is NO
 *   backward-compat path to v1; the user re-enters their data.
 * - For v2/v3 snapshots that pass the version gate, every card MUST have a
 *   valid `defaultStartMinutes` and every entry MUST have a valid
 *   `startMinutes` (both integers in `[0, 1439]`). Missing/invalid values
 *   surface the `missingTimeField` code — distinct from `versionMismatch`
 *   so the UI can render a different message ("snapshot is corrupted / from
 *   an unrecognised v2/v3 build").
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
    // S21: extend the rateType enum to include 'monthly'. v2 snapshots emit
    // only 'hourly' / 'fixed'; v3 may emit any of the three. The v2->v3
    // backfill (see `validateSnapshot`) injects `monthlyTotal: null` on every
    // card BEFORE validation runs, so the field is always present here.
    rateType: z.enum(['hourly', 'fixed', 'monthly']),
    hourlyRate: z.number().nullable(),
    fixedTotal: z.number().nullable(),
    monthlyTotal: z.number().nullable(),
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
    // S27: payment deletes ride the shared tombstone store. S28: reminders too.
    entityType: z.enum(['card', 'entry', 'payment', 'reminder']),
    deletedAt: z.string(),
  })
  .passthrough();

/**
 * S27 — payment row shape on the wire. `amount` must be a positive number;
 * `period` is `YYYY-MM`, `paidOn` is `YYYY-MM-DD`. `passthrough()` keeps
 * unknown keys so a newer client's forward-compatible extension still
 * validates.
 */
const paymentSchema = z
  .object({
    id: z.string().min(1),
    cardId: z.string().min(1),
    period: z.string().regex(/^\d{4}-\d{2}$/, { message: 'payment.period must be YYYY-MM' }),
    amount: z.number().positive(),
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'payment.paidOn must be YYYY-MM-DD',
    }),
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

/**
 * S28 — reminder row shape on the wire. `dueDate` is `YYYY-MM-DD`, `dueMinutes`
 * an integer in `[0, 1439]`. `passthrough()` keeps unknown keys so a newer
 * client's forward-compatible extension still validates.
 */
const reminderSchema = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'reminder.dueDate must be YYYY-MM-DD',
    }),
    dueMinutes: z.number().int().min(0).max(1439),
    doneAt: z.string().nullable(),
    googleEventId: z.string().nullable(),
    syncStatus: z.enum(['pending', 'synced', 'error']),
    syncError: z.string().nullable(),
    notifiedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export const DriveSnapshotSchema = z
  .object({
    // S27: accept schemaVersion 2 (S16), 3 (S21), or 4 (S27). Older inputs
    // are upgraded in-band by `validateSnapshot` (monthlyTotal: null backfill
    // on every card + payments: [] backfill) BEFORE the zod parse runs, so
    // all inputs converge on the v4 shape at this point. v1 (pre-S16) inputs
    // are rejected at the `readSchemaVersion` gate before they reach here.
    schemaVersion: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)], {
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
    payments: z.array(paymentSchema).optional(),
    reminders: z.array(reminderSchema).optional(),
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
 * S21 — v2 -> v3 in-band upgrade. Clones the snapshot shallowly, sets
 * `schemaVersion: 3`, and backfills `monthlyTotal: null` on every card
 * row that is missing the field. Does NOT touch entries / settings /
 * tombstones (they're shape-stable across v2 and v3).
 *
 * Pure: the caller's input is never mutated.
 */
function upgradeSnapshotV2ToV3(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input;
  const obj = input as Record<string, unknown>;
  const cards = Array.isArray(obj.cards) ? obj.cards : [];
  const upgradedCards = cards.map((card) => {
    if (card === null || typeof card !== 'object') return card;
    const c = card as Record<string, unknown>;
    if ('monthlyTotal' in c) return c;
    return { ...c, monthlyTotal: null };
  });
  return { ...obj, schemaVersion: 3, cards: upgradedCards };
}

/**
 * S27 — v3 -> v4 in-band upgrade. Clones the snapshot shallowly, sets
 * `schemaVersion: 4`, and backfills `payments: []` when the field is absent
 * (v2/v3 snapshots predate the payments store). Forward-only, non-destructive
 * — every legacy snapshot restores with an empty payments ledger, matching the
 * S21 v2->v3 policy. Idempotent for v4 inputs (payments already present).
 *
 * Pure: the caller's input is never mutated.
 */
function upgradeSnapshotToV4(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input;
  const obj = input as Record<string, unknown>;
  const payments = Array.isArray(obj.payments) ? obj.payments : [];
  return { ...obj, schemaVersion: 4, payments };
}

/**
 * S28 — v4 -> v5 in-band upgrade. Clones the snapshot shallowly, sets
 * `schemaVersion: 5`, and backfills `reminders: []` when the field is absent
 * (v2/v3/v4 snapshots predate the reminders store). Forward-only,
 * non-destructive — every legacy snapshot restores with an empty reminders
 * list, matching the S27 v3->v4 policy. Idempotent for v5 inputs (reminders
 * already present).
 *
 * Pure: the caller's input is never mutated.
 */
function upgradeSnapshotToV5(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input;
  const obj = input as Record<string, unknown>;
  const reminders = Array.isArray(obj.reminders) ? obj.reminders : [];
  return { ...obj, schemaVersion: 5, reminders };
}

/**
 * Validate an arbitrary JSON value as a `DriveSnapshot`. Returns a
 * discriminated union result; on failure, `code` lets the UI render
 * targeted copy and `error` carries a single line suitable for a toast.
 *
 * S21: v2 snapshots are upgraded in-band before validation — every card row
 * has `monthlyTotal: null` injected if missing, and `schemaVersion` is
 * coerced to `3`. v3 inputs flow through unchanged. v1 (pre-S16) inputs are
 * still hard-rejected with `versionMismatch`.
 */
export function validateSnapshot(input: unknown): SnapshotValidationResult {
  // Step 1: hard-fail anything that isn't v2, v3, or v4. We surface
  // `versionMismatch` even before zod parsing because a v1 snapshot would
  // ALSO fail the `startMinutes`/`defaultStartMinutes` shape checks below,
  // and `missingTimeField` would be the wrong story for the user.
  const version = readSchemaVersion(input);
  if (version !== 2 && version !== 3 && version !== 4 && version !== 5) {
    return {
      ok: false,
      code: 'versionMismatch',
      error:
        'Unsupported snapshot schemaVersion. This backup was created by a different app version.',
      issues: [],
    };
  }

  // Step 1b: in-band upgrade chain. We don't mutate the caller's input —
  // each step clones the top level. v2 -> v3 backfills `monthlyTotal: null`
  // on every card (S21); v3 -> v4 backfills `payments: []` (S27); v4 -> v5
  // backfills `reminders: []` (S28). Running the chain from whatever the input
  // version is converges everything on the v5 shape so the downstream
  // `DriveSnapshot` consumer always sees the current format.
  let upgraded: unknown = input;
  if (version === 2) upgraded = upgradeSnapshotV2ToV3(upgraded);
  upgraded = upgradeSnapshotToV4(upgraded);
  upgraded = upgradeSnapshotToV5(upgraded);

  // Step 2: full zod parse.
  const parsed = DriveSnapshotSchema.safeParse(upgraded);
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

/**
 * Recoverable error thrown by {@link validatePulledSnapshot} when a snapshot
 * pulled from Drive fails shape / schemaVersion validation. The SyncManager /
 * bootstrap catch this like any other flush error: the push row is rescheduled
 * (retryable) and status goes to `error` — the pull is NOT applied and sync is
 * NOT permanently wedged (a subsequent, well-formed `data.json` recovers).
 */
export class InvalidSnapshotError extends Error {
  readonly code: SnapshotValidationErrorCode;
  constructor(code: SnapshotValidationErrorCode, message: string) {
    super(message);
    this.name = 'InvalidSnapshotError';
    this.code = code;
  }
}

/**
 * S31 (UR-31-6): guard the pull path. A truncated / corrupt / `null`-array
 * `data.json` used to reach `lwwMerge` and throw a hard `TypeError`, which
 * wedged sync forever (412 push retries / bootstrap fails every boot with no
 * self-recovery). Validate the pulled snapshot with the SAME validator the
 * restore path uses BEFORE merging; on failure throw a recoverable
 * `InvalidSnapshotError` instead of crashing. On success returns the validated,
 * in-band-upgraded `DriveSnapshot` (missing arrays backfilled, schemaVersion
 * coerced) ready to merge.
 */
export function validatePulledSnapshot(input: unknown): DriveSnapshot {
  const result = validateSnapshot(input);
  if (!result.ok) {
    throw new InvalidSnapshotError(
      result.code,
      `Pulled Drive snapshot is invalid (${result.code}): ${result.error}`,
    );
  }
  return result.snapshot;
}
