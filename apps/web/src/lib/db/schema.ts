import Dexie, { type EntityTable } from 'dexie';

import type { Card, Entry, Settings } from '@hourtrack/shared-types';

/**
 * Dexie schema for HourTrack. v1 ships in S02; bump the version and add a
 * migration via `.upgrade()` for ANY structural change after S02 lands.
 *
 * Stores (per sprint spec):
 *
 *   cards      -- primary key `id`. Indexes: `name`, `isArchived`, `updatedAt`.
 *   entries    -- primary key `id`. Indexes: `cardId`, `date`, `syncStatus`,
 *                 `updatedAt`, compound `[cardId+date]` for fast day lookups.
 *   settings   -- primary key `key`. Holds a single row with key='current'.
 *   syncQueue  -- auto-increment `id`. Holds pending operations for S10. The
 *                 schema lives here from day 1 so we never need a Dexie
 *                 version bump just to introduce the queue.
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

export class HourTrackDB extends Dexie {
  cards!: EntityTable<Card, 'id'>;
  entries!: EntityTable<Entry, 'id'>;
  settings!: EntityTable<SettingsRow, 'key'>;
  syncQueue!: EntityTable<SyncQueueRow, 'id'>;

  constructor(name = 'hourtrack') {
    super(name);
    this.version(1).stores({
      cards: 'id, name, isArchived, updatedAt',
      entries: 'id, cardId, date, [cardId+date], syncStatus, updatedAt',
      settings: 'key',
      syncQueue: '++id, op, entityType, entityId, createdAt',
    });
  }
}

/** Shared singleton used by the web app at runtime. */
export const db = new HourTrackDB();
