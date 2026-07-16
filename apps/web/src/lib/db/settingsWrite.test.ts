import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HourTrackDB } from './schema';
import { getSettings, initDB, updateSettings } from './queries';

/**
 * S29 Task 6 + Task 7 — the settings write path.
 *
 *  - A preference change stamps `settingsUpdatedAt`; a bookkeeping-only write
 *    does NOT (so the LWW merge can tell them apart).
 *  - Concurrent patches both land (atomic read-modify-write): the second
 *    patch must not clobber the first with a stale base.
 */

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-setwrite-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

describe('updateSettings — settingsUpdatedAt stamping (Task 6)', () => {
  it('stamps settingsUpdatedAt on a preference change', async () => {
    const before = await getSettings(db);
    expect(before?.settingsUpdatedAt).toBeUndefined();

    await updateSettings(db, { theme: 'dark' });

    const after = await getSettings(db);
    expect(after?.theme).toBe('dark');
    expect(after?.settingsUpdatedAt).toBeTruthy();
  });

  it('does NOT stamp settingsUpdatedAt on a bookkeeping-only write', async () => {
    await updateSettings(db, {
      driveDataEtag: 'etag-1',
      lastSyncAt: '2026-05-15T00:00:00.000Z',
      hourtrackCalendarId: 'cal-1',
    });
    const row = await getSettings(db);
    expect(row?.driveDataEtag).toBe('etag-1');
    expect(row?.settingsUpdatedAt).toBeUndefined();
  });

  it('preserves an explicit settingsUpdatedAt supplied by the caller', async () => {
    await updateSettings(db, { theme: 'light', settingsUpdatedAt: '2026-01-01T00:00:00.000Z' });
    const row = await getSettings(db);
    expect(row?.settingsUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('updateSettings — atomic concurrent patches (Task 7)', () => {
  it('two concurrent patches to different fields both land', async () => {
    await Promise.all([
      updateSettings(db, { theme: 'dark' }),
      updateSettings(db, { hourtrackCalendarId: 'cal-123' }),
    ]);

    const row = await getSettings(db);
    // A non-atomic get→spread→put would drop one of these (the loser reads a
    // stale base and overwrites the winner).
    expect(row?.theme).toBe('dark');
    expect(row?.hourtrackCalendarId).toBe('cal-123');
  });
});
