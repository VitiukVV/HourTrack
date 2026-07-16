import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Reminder } from '@hourtrack/shared-types';

import { HourTrackDB } from './schema';
import {
  createReminder,
  deleteReminder,
  getAllReminders,
  getAllTombstones,
  listDueReminders,
  listOpenReminders,
  updateReminder,
} from './queries';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-reminders-${Math.random().toString(36).slice(2)}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function makeReminder(
  overrides: Partial<Omit<Reminder, 'createdAt' | 'updatedAt'>> = {},
): Omit<Reminder, 'createdAt' | 'updatedAt'> {
  return {
    id: 'r-' + Math.random().toString(36).slice(2, 8),
    text: 'Забрати кошти',
    dueDate: '2026-08-04',
    dueMinutes: 540, // 09:00
    doneAt: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    notifiedAt: null,
    ...overrides,
  };
}

describe('reminder CRUD', () => {
  it('creates and reads back a reminder with timestamps', async () => {
    const created = await createReminder(db, makeReminder({ id: 'r1' }));
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBe(created.createdAt);
    const fetched = await db.reminders.get('r1');
    expect(fetched?.text).toBe('Забрати кошти');
  });

  it('rejects empty text and out-of-range dueMinutes', async () => {
    await expect(createReminder(db, makeReminder({ text: '   ' }))).rejects.toThrow(/text/);
    await expect(createReminder(db, makeReminder({ dueMinutes: 1440 }))).rejects.toThrow(
      /dueMinutes/,
    );
    await expect(createReminder(db, makeReminder({ dueMinutes: -1 }))).rejects.toThrow(
      /dueMinutes/,
    );
  });

  it('updateReminder bumps updatedAt and validates dueMinutes', async () => {
    const created = await createReminder(db, makeReminder({ id: 'r1' }));
    await new Promise((r) => setTimeout(r, 2));
    const updated = await updateReminder(db, 'r1', { text: 'нове' });
    expect(updated.text).toBe('нове');
    expect(updated.updatedAt >= created.updatedAt).toBe(true);
    await expect(updateReminder(db, 'r1', { dueMinutes: 2000 })).rejects.toThrow(/dueMinutes/);
  });

  it('deleteReminder writes a reminder tombstone and is idempotent', async () => {
    await createReminder(db, makeReminder({ id: 'r1', googleEventId: 'evt-1' }));
    const deleted = await deleteReminder(db, 'r1');
    expect(deleted?.googleEventId).toBe('evt-1');
    expect(await db.reminders.get('r1')).toBeUndefined();
    const tombstones = await getAllTombstones(db);
    expect(tombstones).toContainEqual(
      expect.objectContaining({ entityId: 'r1', entityType: 'reminder' }),
    );
    // Second delete is a no-op.
    expect(await deleteReminder(db, 'r1')).toBeNull();
  });
});

describe('listOpenReminders', () => {
  it('excludes done reminders and sorts soonest-due first', async () => {
    await createReminder(db, makeReminder({ id: 'late', dueDate: '2026-08-10', dueMinutes: 600 }));
    await createReminder(db, makeReminder({ id: 'early', dueDate: '2026-08-04', dueMinutes: 540 }));
    await createReminder(
      db,
      makeReminder({ id: 'done', dueDate: '2026-08-01', doneAt: '2026-08-01T10:00:00.000Z' }),
    );
    const open = await listOpenReminders(db);
    expect(open.map((r) => r.id)).toEqual(['early', 'late']);
  });
});

describe('listDueReminders — boundary cases', () => {
  const NOW = new Date(2026, 7, 4, 9, 0, 0); // 2026-08-04 09:00 local

  it('includes a reminder due exactly now', async () => {
    await createReminder(db, makeReminder({ id: 'now', dueDate: '2026-08-04', dueMinutes: 540 }));
    const due = await listDueReminders(db, NOW);
    expect(due.map((r) => r.id)).toEqual(['now']);
  });

  it('excludes a reminder due one minute from now', async () => {
    await createReminder(db, makeReminder({ id: 'soon', dueDate: '2026-08-04', dueMinutes: 541 }));
    expect(await listDueReminders(db, NOW)).toHaveLength(0);
  });

  it('includes an earlier-today reminder and excludes tomorrow', async () => {
    await createReminder(
      db,
      makeReminder({ id: 'morning', dueDate: '2026-08-04', dueMinutes: 480 }),
    );
    await createReminder(
      db,
      makeReminder({ id: 'tomorrow', dueDate: '2026-08-05', dueMinutes: 0 }),
    );
    const due = await listDueReminders(db, NOW);
    expect(due.map((r) => r.id)).toEqual(['morning']);
  });

  it('excludes a past-due reminder that is already done', async () => {
    await createReminder(
      db,
      makeReminder({
        id: 'donepast',
        dueDate: '2026-08-01',
        dueMinutes: 0,
        doneAt: '2026-08-01T00:30:00.000Z',
      }),
    );
    expect(await listDueReminders(db, NOW)).toHaveLength(0);
  });
});

describe('getAllReminders', () => {
  it('returns all reminders sorted by id', async () => {
    await createReminder(db, makeReminder({ id: 'b' }));
    await createReminder(db, makeReminder({ id: 'a' }));
    const all = await getAllReminders(db);
    expect(all.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
