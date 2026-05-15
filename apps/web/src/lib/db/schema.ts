import Dexie, { type EntityTable } from 'dexie';

import type {
  Card,
  Entry,
  Settings,
  Tombstone,
  TombstoneEntityType,
} from '@hourtrack/shared-types';

/**
 * Dexie schema for HourTrack. v1 ships in S02; bump the version and add a
 * migration via `.upgrade()` for ANY structural change after S02 lands.
 *
 * Stores (per sprint spec):
 *
 *   cards       -- primary key `id`. Indexes: `name`, `isArchived`, `updatedAt`.
 *   entries     -- primary key `id`. Indexes: `cardId`, `date`, `syncStatus`,
 *                  `updatedAt`, compound `[cardId+date]` for fast day lookups.
 *   settings    -- primary key `key`. Holds a single row with key='current'.
 *   syncQueue   -- auto-increment `id`. Holds pending operations for S10. The
 *                  schema lives here from day 1 so we never need a Dexie
 *                  version bump just to introduce the queue.
 *
 * v2 (S09): adds `authTokens` store, holding a single row keyed `'current'`
 * that carries the Google access token, optional refresh token, expiry, and
 * cached user-profile fields. The migration is additive — existing v1 rows
 * are unchanged. Refresh tokens MUST live here (IndexedDB) and NEVER in
 * localStorage — XSS containment per PROJECT_PLAN.md section 9.1.
 *
 * v3 (S10): adds `tombstones` store. Each row records that an entity was
 * deleted on this device — the SyncManager includes them in the next Drive
 * snapshot so other devices see the delete instead of treating the absence
 * as "not synced yet". Pruned after 30 days. v3 also extends Settings rows
 * (additive only — `deviceId`, `driveDataFileId`, `driveDataEtag` are
 * forward-compatible nullable fields with default `null` filled by the
 * upgrade callback).
 */

/**
 * Row shape for the `settings` store. We persist `Settings` PLUS a `key`
 * primary key so Dexie can index it. There is exactly one row at all times,
 * with `key === 'current'`.
 */
export type SettingsRow = Settings & { key: 'current' };

/**
 * Row shape for the `syncQueue` store. Filled in by S10 SyncManager.
 *
 * `op` describes the kind of work to do:
 *   - `pushDataJson`         -- rebuild snapshot from Dexie + upload to Drive
 *                               `data.json`. Idempotent: multiple queued
 *                               pushes coalesce to a single Drive write.
 *   - `createCalendarEvent`  -- create a Google Calendar event for an entry
 *                               (S12). `entityId` is the entry id.
 *   - `updateCalendarEvent`  -- PATCH an existing Calendar event (S12).
 *                               `entityId` is the entry id.
 *   - `deleteCalendarEvent`  -- DELETE a Calendar event by `googleEventId`
 *                               (S12). The entry row has already been
 *                               removed from Dexie by the time this op
 *                               runs; `payload.googleEventId` carries the
 *                               event id captured at delete time.
 *   - `bulkUpdateCardEvents` -- PATCH every synced event belonging to a
 *                               card (S12). Triggered by card rename or
 *                               recolor. `entityId` is the card id.
 *
 * `entityType` + `entityId` carry the originating change (e.g. "card abc was
 * deleted"). The legacy `'create' | 'update' | 'delete'` shape is preserved
 * via the optional `mutation` field — readers should treat both the wide
 * `op` and `mutation` fields as informational metadata; the actual work is
 * driven by `op`.
 *
 * `payload` carries op-specific extras (e.g. the Google event id for
 * `deleteCalendarEvent`). Optional and untyped for forward-compatibility.
 * `nextAttemptAt` + `attempts` drive the retry scheduler.
 *
 * NB: extending the op union does NOT require a Dexie schema version bump.
 * The `op` column is indexed by name (not by value enum), and v3's
 * declaration `syncQueue: '++id, op, entityType, entityId, createdAt,
 * nextAttemptAt'` already accommodates any string value. S12 ships the new
 * ops without a v4 migration. (Historical note: the S10 follow-up flagged
 * "bump to v4" assuming the Entry fields needed extending — those fields
 * already exist in v3, so the migration is unnecessary. Documented in the
 * S12 journal entry.)
 */
export type SyncQueueOp =
  | 'pushDataJson'
  | 'createCalendarEvent'
  | 'updateCalendarEvent'
  | 'deleteCalendarEvent'
  | 'bulkUpdateCardEvents';

export interface SyncQueueRow {
  id?: number;
  op: SyncQueueOp;
  /** Optional CRUD descriptor; informational only. */
  mutation?: 'create' | 'update' | 'delete';
  entityType?: 'card' | 'entry';
  entityId?: string;
  /** Op-specific extras (e.g. `{ googleEventId: '...' }`). */
  payload?: Record<string, unknown>;
  createdAt: string;
  /** Number of failed attempts so far. Drives the backoff schedule. */
  attempts?: number;
  /** Epoch ms — operation is held back until `Date.now() >= nextAttemptAt`. */
  nextAttemptAt?: number;
  /** Last error message, kept for the dev-mode conflict / sync log. */
  lastError?: string | null;
}

/**
 * Row shape for the v3 `tombstones` store.
 *
 * One row per deleted entity. The `entityId` is the primary key so a
 * subsequent delete-of-the-same-id (rare but possible across restore flows)
 * idempotently overwrites the existing tombstone instead of duplicating it.
 */
export interface TombstoneRow extends Tombstone {
  // Mirror the public Tombstone shape; entityId is the Dexie primary key.
  entityId: string;
  entityType: TombstoneEntityType;
  deletedAt: string;
}

/**
 * Row shape for the v2 `authTokens` store (S09). A single row keyed
 * `'current'` carries the Google PKCE session.
 *
 * `refreshToken` is `string | null` because Google's PKCE flow for browser
 * public clients does not reliably issue one — silent re-auth via
 * `prompt: 'none'` is the primary renewal mechanism. If a refresh token IS
 * issued (some client configurations do), it is stored here and used
 * preferentially.
 *
 * `scope` is the space-separated string Google echoes back from the token
 * response. Surfaced in Settings -> About -> Granted scopes for transparency.
 */
export interface AuthTokensRow {
  key: 'current';
  accessToken: string;
  /** Epoch ms when `accessToken` expires. */
  accessTokenExpiresAt: number;
  refreshToken: string | null;
  /** OpenID Connect ID token (JWT). Used for silent re-auth `id_token_hint`. */
  idToken: string | null;
  /** Space-separated granted scopes echoed by Google. */
  scope: string;
  /** Cached user profile fields (filled after first `getUserInfo`). */
  email: string | null;
  name: string | null;
  picture: string | null;
}

export class HourTrackDB extends Dexie {
  cards!: EntityTable<Card, 'id'>;
  entries!: EntityTable<Entry, 'id'>;
  settings!: EntityTable<SettingsRow, 'key'>;
  syncQueue!: EntityTable<SyncQueueRow, 'id'>;
  authTokens!: EntityTable<AuthTokensRow, 'key'>;
  tombstones!: EntityTable<TombstoneRow, 'entityId'>;

  constructor(name = 'hourtrack') {
    super(name);
    this.version(1).stores({
      cards: 'id, name, isArchived, updatedAt',
      entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
      settings: 'key',
      syncQueue: '++id, op, entityType, entityId, createdAt',
    });
    // v2 adds the `authTokens` store. The migration is additive — Dexie
    // implicitly carries v1 stores forward when `.stores({...})` re-declares
    // them with unchanged schemas. The `.upgrade()` callback is a no-op for
    // existing data but exists so future v3+ migrations have a hook point.
    this.version(2)
      .stores({
        cards: 'id, name, isArchived, updatedAt',
        entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
        settings: 'key',
        syncQueue: '++id, op, entityType, entityId, createdAt',
        authTokens: 'key',
      })
      .upgrade(async () => {
        // No data migration needed -- v2 only adds a new store. Hook is kept
        // so v3+ migrations can chain off it without a separate version bump.
      });
    // v3 (S10) adds the `tombstones` store and extends Settings with the
    // sync-bookkeeping fields. The Settings upgrade fills the new fields with
    // `null` for any row that predates v3.
    this.version(3)
      .stores({
        cards: 'id, name, isArchived, updatedAt',
        entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
        settings: 'key',
        syncQueue: '++id, op, entityType, entityId, createdAt, nextAttemptAt',
        authTokens: 'key',
        tombstones: 'entityId, entityType, deletedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table<SettingsRow, 'key'>('settings')
          .toCollection()
          .modify((row) => {
            if (row.deviceId === undefined) row.deviceId = null;
            if (row.driveDataFileId === undefined) row.driveDataFileId = null;
            if (row.driveDataEtag === undefined) row.driveDataEtag = null;
          });
      });
  }
}

/** Shared singleton used by the web app at runtime. */
export const db = new HourTrackDB();
