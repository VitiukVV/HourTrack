import { describe, expect, it } from 'vitest';

import type { DriveSnapshot, Reminder, Settings } from '@hourtrack/shared-types';

import { lwwMerge } from './lwwMerge';

function baseSettings(): Settings {
  return {
    language: 'en',
    theme: 'system',
    defaultView: 'month',
    hourtrackCalendarId: null,
    autoBackupEnabled: true,
    autoBackupIntervalDays: 3,
    lastBackupAt: null,
    lastSyncAt: null,
    firstLoginAt: null,
    deviceId: null,
    driveDataFileId: null,
    driveDataEtag: null,
    onboardingSeen: false,
  };
}

function makeReminder(id: string, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id,
    text: 'Забрати кошти',
    dueDate: '2026-08-04',
    dueMinutes: 540,
    doneAt: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    notifiedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<DriveSnapshot> = {}): DriveSnapshot {
  return {
    schemaVersion: 5,
    exportedAt: '2026-08-01T00:00:00.000Z',
    deviceId: 'device-local',
    settings: baseSettings(),
    cards: [],
    entries: [],
    payments: [],
    reminders: [],
    tombstones: [],
    ...overrides,
  };
}

describe('lwwMerge — reminders', () => {
  it('unions reminders present on only one side', () => {
    const local = makeSnapshot({ reminders: [makeReminder('r1')] });
    const remote = makeSnapshot({ reminders: [makeReminder('r2')] });
    const { snapshot } = lwwMerge(local, remote);
    expect(snapshot.reminders?.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });

  it('picks the newer reminder by updatedAt (remote wins) and records a conflict', () => {
    const local = makeSnapshot({
      reminders: [makeReminder('r1', { text: 'old', updatedAt: '2026-08-01T00:00:00.000Z' })],
    });
    const remote = makeSnapshot({
      reminders: [makeReminder('r1', { text: 'new', updatedAt: '2026-08-02T00:00:00.000Z' })],
    });
    const { snapshot, conflictsResolved } = lwwMerge(local, remote);
    expect(snapshot.reminders?.find((r) => r.id === 'r1')?.text).toBe('new');
    expect(conflictsResolved).toContainEqual(
      expect.objectContaining({ entityType: 'reminder', entityId: 'r1', resolution: 'remote' }),
    );
  });

  it('a reminder tombstone (deletedAt > updatedAt) wins over a stale remote edit', () => {
    const local = makeSnapshot({
      reminders: [],
      tombstones: [
        { entityId: 'r1', entityType: 'reminder', deletedAt: '2026-08-03T00:00:00.000Z' },
      ],
    });
    const remote = makeSnapshot({
      reminders: [makeReminder('r1', { updatedAt: '2026-08-01T00:00:00.000Z' })],
    });
    const { snapshot, conflictsResolved } = lwwMerge(local, remote);
    expect(snapshot.reminders?.some((r) => r.id === 'r1')).toBe(false);
    expect(conflictsResolved).toContainEqual(
      expect.objectContaining({ entityType: 'reminder', entityId: 'r1', resolution: 'tombstone' }),
    );
  });

  it('carries reminders when one side omits the field entirely (v4 snapshot)', () => {
    const localNoReminders = makeSnapshot();
    delete (localNoReminders as { reminders?: unknown }).reminders;
    const remote = makeSnapshot({ reminders: [makeReminder('r9')] });
    const { snapshot } = lwwMerge(localNoReminders, remote);
    expect(snapshot.reminders?.map((r) => r.id)).toEqual(['r9']);
  });
});
