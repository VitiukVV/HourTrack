import Dexie, { type EntityTable } from 'dexie';

import type { Card, Entry, Settings } from '@hourtrack/shared-types';

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
 */

/**
 * Row shape for the `settings` store. We persist `Settings` PLUS a `key`
 * primary key so Dexie can index it. There is exactly one row at all times,
 * with `key === 'current'`.
 */
export type SettingsRow = Settings & { key: 'current' };

/**
 * Row shape for the `syncQueue` store. Filled in by S10 SyncManager; S02
 * only declares the store so the schema is forward-compatible.
 */
export interface SyncQueueRow {
  id?: number;
  op: 'create' | 'update' | 'delete';
  entityType: 'card' | 'entry';
  entityId: string;
  createdAt: string;
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
  }
}

/** Shared singleton used by the web app at runtime. */
export const db = new HourTrackDB();
