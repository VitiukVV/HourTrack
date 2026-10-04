import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Entry } from '@hourtrack/shared-types';

import { resetCalendarSyncFields } from './queries';
import { HourTrackDB } from './schema';

/**
 * Spec 004 (FR-003) — Settings → disconnect Google Calendar resets every
 * entry's Calendar-sync fields so a later reconnect re-syncs from scratch.
 * Moved out of `CalendarSection.tsx`, which wrote `db.entries` directly.
 */

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-reset-cal-${Math.random().toString(36).slice(2)}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function entry(id: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    cardId: 'c1',
    date: '2026-10-04',
    startMinutes: 540,
    durationMin: 60,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resetCalendarSyncFields', () => {
  it('clears googleEventId / syncError and sets syncStatus to pending on every touched entry', async () => {
    await db.entries.bulkAdd([
      entry('synced', { googleEventId: 'ev1', syncStatus: 'synced' }),
      entry('failed', { syncStatus: 'error', syncError: 'boom' }),
      entry('clean'),
    ]);

    const changed = await resetCalendarSyncFields(db);

    expect(changed).toBe(2);
    for (const row of await db.entries.toArray()) {
      expect(row).toMatchObject({ googleEventId: null, syncStatus: 'pending', syncError: null });
    }
  });

  it('leaves every other field — including updatedAt — untouched, as before the move', async () => {
    const before = entry('synced', { googleEventId: 'ev1', syncStatus: 'synced', note: 'n' });
    await db.entries.add(before);

    await resetCalendarSyncFields(db);

    expect(await db.entries.get('synced')).toEqual({
      ...before,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
    });
  });
});
