import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DriveSnapshot } from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import { createReminder, getAllReminders, initDB } from '@/lib/db/queries';

import { applySnapshot, buildSnapshot } from './snapshot';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-snap-rem-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

describe('snapshot v5 — reminders', () => {
  it('buildSnapshot emits schemaVersion 5 and includes reminders', async () => {
    await createReminder(db, {
      id: 'r1',
      text: 'Забрати кошти в Марі за липень',
      dueDate: '2026-08-04',
      dueMinutes: 540,
      doneAt: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
      notifiedAt: null,
    });
    const snap = await buildSnapshot(db);
    expect(snap.schemaVersion).toBe(5);
    expect(snap.reminders).toHaveLength(1);
    expect(snap.reminders?.[0]).toMatchObject({ id: 'r1', dueDate: '2026-08-04', dueMinutes: 540 });
  });

  it('round-trips reminders through build -> apply into a fresh db', async () => {
    await createReminder(db, {
      id: 'r1',
      text: 'A',
      dueDate: '2026-08-04',
      dueMinutes: 540,
      doneAt: null,
      googleEventId: 'evt-1',
      syncStatus: 'synced',
      syncError: null,
      notifiedAt: null,
    });
    await createReminder(db, {
      id: 'r2',
      text: 'B',
      dueDate: '2026-08-05',
      dueMinutes: 0,
      doneAt: '2026-08-05T00:10:00.000Z',
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
      notifiedAt: '2026-08-05T00:00:00.000Z',
    });
    const snap = await buildSnapshot(db);

    const db2 = new HourTrackDB(`hourtrack-snap-rem2-${Math.random().toString(36).slice(2)}`);
    await db2.open();
    await initDB(db2);
    const result = await applySnapshot(snap, db2);
    expect(result.reminders).toBe(2);
    const applied = await getAllReminders(db2);
    expect(applied.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    expect(applied.find((r) => r.id === 'r1')?.googleEventId).toBe('evt-1');
    expect(applied.find((r) => r.id === 'r2')?.notifiedAt).toBe('2026-08-05T00:00:00.000Z');
    await db2.delete();
  });

  it('applies a v4 snapshot (no reminders field) with an empty reminders store', async () => {
    await createReminder(db, {
      id: 'stale',
      text: 'stale',
      dueDate: '2026-06-01',
      dueMinutes: 0,
      doneAt: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
      notifiedAt: null,
    });
    const v4Snapshot = {
      schemaVersion: 4,
      exportedAt: '2026-07-01T00:00:00.000Z',
      deviceId: 'device-x',
      settings: (await buildSnapshot(db)).settings,
      cards: [],
      entries: [],
      payments: [],
      tombstones: [],
      // note: no `reminders` key at all
    } as unknown as DriveSnapshot;

    const result = await applySnapshot(v4Snapshot, db);
    expect(result.reminders).toBe(0);
    expect(await getAllReminders(db)).toHaveLength(0);
  });
});
