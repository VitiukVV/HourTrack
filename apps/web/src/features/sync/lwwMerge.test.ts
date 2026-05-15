import { describe, expect, it } from 'vitest';

import type { Card, DriveSnapshot, Entry, Settings, Tombstone } from '@hourtrack/shared-types';

import { lwwMerge } from './lwwMerge';

function baseSettings(overrides: Partial<Settings> = {}): Settings {
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
    ...overrides,
  };
}

function makeCard(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    name: `card-${id}`,
    color: '#EF4444',
    defaultDurationMin: 480,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeEntry(id: string, cardId: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    cardId,
    date: '2026-05-14',
    durationMin: 240,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<DriveSnapshot> = {}): DriveSnapshot {
  return {
    schemaVersion: 1,
    exportedAt: '2026-05-15T00:00:00.000Z',
    deviceId: 'device-local',
    settings: baseSettings(),
    cards: [],
    entries: [],
    tombstones: [],
    ...overrides,
  };
}

describe('lwwMerge', () => {
  it('keeps the local card when local updatedAt is newer', () => {
    const local = makeSnapshot({
      cards: [makeCard('c1', { name: 'local-newer', updatedAt: '2026-05-10T00:00:00.000Z' })],
    });
    const remote = makeSnapshot({
      cards: [makeCard('c1', { name: 'remote-older', updatedAt: '2026-05-09T00:00:00.000Z' })],
    });
    const { snapshot, conflictsResolved } = lwwMerge(local, remote);
    expect(snapshot.cards).toHaveLength(1);
    expect(snapshot.cards[0]!.name).toBe('local-newer');
    expect(conflictsResolved.filter((c) => c.entityType === 'card')).toHaveLength(0);
  });

  it('takes the remote entry when remote updatedAt is newer + records the conflict', () => {
    const local = makeSnapshot({
      cards: [makeCard('c1')],
      entries: [makeEntry('e1', 'c1', { durationMin: 60, updatedAt: '2026-05-12T00:00:00.000Z' })],
    });
    const remote = makeSnapshot({
      cards: [makeCard('c1')],
      entries: [makeEntry('e1', 'c1', { durationMin: 120, updatedAt: '2026-05-13T00:00:00.000Z' })],
    });
    const { snapshot, conflictsResolved } = lwwMerge(local, remote);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]!.durationMin).toBe(120);
    const entryConflicts = conflictsResolved.filter((c) => c.entityType === 'entry');
    expect(entryConflicts).toHaveLength(1);
    expect(entryConflicts[0]!.resolution).toBe('remote');
  });

  it('resolves to deleted when a tombstone is newer than the row', () => {
    const tomb: Tombstone = {
      entityId: 'c1',
      entityType: 'card',
      deletedAt: '2026-05-13T00:00:00.000Z',
    };
    const local = makeSnapshot({
      cards: [makeCard('c1', { updatedAt: '2026-05-10T00:00:00.000Z' })],
      tombstones: [tomb],
    });
    const remote = makeSnapshot({
      cards: [makeCard('c1', { updatedAt: '2026-05-12T00:00:00.000Z' })],
    });
    const { snapshot, conflictsResolved } = lwwMerge(local, remote);
    expect(snapshot.cards).toHaveLength(0);
    expect(snapshot.tombstones).toEqual([tomb]);
    expect(conflictsResolved.some((c) => c.resolution === 'tombstone')).toBe(true);
  });

  it('preserves a restored row whose updatedAt EQUALS the tombstone deletedAt (tie -> row wins)', () => {
    // Regression for the `>=` -> `>` fix: restoreCard can stamp the same
    // ISO millisecond as the inbound tombstone when the clocks coincide.
    // Under the old `>=` rule the restore was silently dropped on merge.
    const sameInstant = '2026-05-15T10:00:00.000Z';
    const tomb: Tombstone = {
      entityId: 'c1',
      entityType: 'card',
      deletedAt: sameInstant,
    };
    const local = makeSnapshot({
      cards: [makeCard('c1', { updatedAt: sameInstant, name: 'restored' })],
    });
    const remote = makeSnapshot({ tombstones: [tomb] });
    const { snapshot } = lwwMerge(local, remote);
    expect(snapshot.cards).toHaveLength(1);
    expect(snapshot.cards[0]!.name).toBe('restored');
  });

  it('preserves a re-created row when its updatedAt is newer than the tombstone', () => {
    const tomb: Tombstone = {
      entityId: 'c1',
      entityType: 'card',
      deletedAt: '2026-05-10T00:00:00.000Z',
    };
    const local = makeSnapshot({
      cards: [makeCard('c1', { updatedAt: '2026-05-12T00:00:00.000Z', name: 'recreated' })],
      tombstones: [tomb],
    });
    const remote = makeSnapshot({ tombstones: [tomb] });
    const { snapshot } = lwwMerge(local, remote);
    expect(snapshot.cards).toHaveLength(1);
    expect(snapshot.cards[0]!.name).toBe('recreated');
  });

  it('preserves concurrent edits on different entities', () => {
    const local = makeSnapshot({
      cards: [makeCard('c1', { name: 'local-c1' })],
      entries: [makeEntry('e1', 'c1', { note: 'local-note' })],
    });
    const remote = makeSnapshot({
      cards: [makeCard('c2', { name: 'remote-c2' })],
      entries: [makeEntry('e2', 'c2', { note: 'remote-note' })],
    });
    const { snapshot } = lwwMerge(local, remote);
    expect(snapshot.cards.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(snapshot.entries.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('merges settings: lastSyncAt takes the LATER value', () => {
    const local = makeSnapshot({
      exportedAt: '2026-05-14T00:00:00.000Z',
      settings: baseSettings({
        lastSyncAt: '2026-05-14T12:00:00.000Z',
        theme: 'dark',
      }),
    });
    const remote = makeSnapshot({
      exportedAt: '2026-05-15T00:00:00.000Z',
      settings: baseSettings({
        lastSyncAt: '2026-05-15T08:00:00.000Z',
        theme: 'light',
      }),
    });
    const { snapshot } = lwwMerge(local, remote);
    expect(snapshot.settings.lastSyncAt).toBe('2026-05-15T08:00:00.000Z');
    // remote exportedAt is newer → theme adopts the remote value
    expect(snapshot.settings.theme).toBe('light');
  });

  it('settings deviceId is always local — never overwritten by remote', () => {
    const local = makeSnapshot({
      settings: baseSettings({ deviceId: 'local-device' }),
    });
    const remote = makeSnapshot({
      exportedAt: '2099-01-01T00:00:00.000Z',
      settings: baseSettings({ deviceId: 'remote-device' }),
    });
    const { snapshot } = lwwMerge(local, remote);
    expect(snapshot.settings.deviceId).toBe('local-device');
  });

  it('prunes tombstones older than the TTL', () => {
    const now = new Date('2026-05-15T00:00:00.000Z');
    const oldTomb: Tombstone = {
      entityId: 'old',
      entityType: 'card',
      deletedAt: '2026-04-01T00:00:00.000Z', // ~45 days ago
    };
    const recentTomb: Tombstone = {
      entityId: 'recent',
      entityType: 'card',
      deletedAt: '2026-05-10T00:00:00.000Z',
    };
    const local = makeSnapshot({ tombstones: [oldTomb, recentTomb] });
    const remote = makeSnapshot();
    const { snapshot } = lwwMerge(local, remote, { tombstoneTtlDays: 30, now });
    expect(snapshot.tombstones?.map((t) => t.entityId)).toEqual(['recent']);
  });

  it('merges tombstones from both sides, keeping the later deletedAt', () => {
    const localTomb: Tombstone = {
      entityId: 'x',
      entityType: 'entry',
      deletedAt: '2026-05-10T00:00:00.000Z',
    };
    const remoteTomb: Tombstone = {
      entityId: 'x',
      entityType: 'entry',
      deletedAt: '2026-05-12T00:00:00.000Z',
    };
    const local = makeSnapshot({ tombstones: [localTomb] });
    const remote = makeSnapshot({ tombstones: [remoteTomb] });
    const { snapshot } = lwwMerge(local, remote);
    expect(snapshot.tombstones).toHaveLength(1);
    expect(snapshot.tombstones?.[0]?.deletedAt).toBe('2026-05-12T00:00:00.000Z');
  });
});
