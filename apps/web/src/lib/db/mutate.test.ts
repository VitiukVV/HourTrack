import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Reminder } from '@hourtrack/shared-types';

import { deleteWithTombstone, nowIso, patchRow } from './mutate';
import { HourTrackDB } from './schema';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-mutate-${Math.random().toString(36).slice(2)}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1',
    text: 'Pay rent',
    dueDate: '2026-10-04',
    dueMinutes: 600,
    doneAt: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    notifiedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('nowIso', () => {
  it('returns an ISO-8601 UTC timestamp', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('patchRow', () => {
  it('merges the patch, keeps id and createdAt, and stamps updatedAt', async () => {
    await db.reminders.add(reminder());
    const next = await patchRow(
      db.reminders,
      'r1',
      { text: 'Pay rent today' },
      'updateReminder: reminder not found',
    );
    expect(next.text).toBe('Pay rent today');
    expect(next.id).toBe('r1');
    expect(next.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(next.updatedAt > '2026-01-01T00:00:00.000Z').toBe(true);
    expect(await db.reminders.get('r1')).toEqual(next);
  });

  it('throws "<label>: <id>" when the row does not exist', async () => {
    await expect(
      patchRow(db.reminders, 'nope', { text: 'x' }, 'updateReminder: reminder not found'),
    ).rejects.toThrow('updateReminder: reminder not found: nope');
  });

  it('runs validate on the merged row and writes nothing when it throws', async () => {
    await db.reminders.add(reminder());
    const validate = (r: Reminder) => {
      if (r.dueMinutes > 1439) throw new Error('out of range');
    };
    await expect(
      patchRow(db.reminders, 'r1', { dueMinutes: 5000 }, 'not found', validate),
    ).rejects.toThrow('out of range');
    expect((await db.reminders.get('r1'))?.dueMinutes).toBe(600);
  });
});

describe('deleteWithTombstone', () => {
  it('deletes the row, writes a tombstone and returns the deleted row', async () => {
    await db.reminders.add(reminder());
    const deleted = await deleteWithTombstone(db, db.reminders, 'reminder', 'r1');
    expect(deleted?.id).toBe('r1');
    expect(await db.reminders.get('r1')).toBeUndefined();
    const tomb = await db.tombstones.get('r1');
    expect(tomb?.entityType).toBe('reminder');
    expect(typeof tomb?.deletedAt).toBe('string');
  });

  it('is idempotent: returns null and writes no tombstone for a missing row', async () => {
    expect(await deleteWithTombstone(db, db.reminders, 'reminder', 'nope')).toBeNull();
    expect(await db.tombstones.count()).toBe(0);
  });

  it('rolls the delete back when the tombstone write fails — no untracked delete', async () => {
    await db.reminders.add(reminder());
    db.tombstones.hook('creating', () => {
      throw new Error('boom');
    });
    await expect(deleteWithTombstone(db, db.reminders, 'reminder', 'r1')).rejects.toThrow('boom');
    expect(await db.reminders.get('r1')).toBeDefined();
    expect(await db.tombstones.count()).toBe(0);
  });
});
