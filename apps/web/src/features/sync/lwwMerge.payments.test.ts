import { describe, expect, it } from 'vitest';

import type { DriveSnapshot, Payment, Settings } from '@hourtrack/shared-types';

import { lwwMerge } from './lwwMerge';

/**
 * Fixed merge clock. The fixtures below use absolute July-2026 timestamps, and
 * `lwwMerge` prunes tombstones older than its 30-day TTL relative to `now`.
 * Without pinning `now` these tests were a time bomb: the tombstone case
 * started failing once wall-clock drifted more than 30 days past 2026-07-12,
 * because the tombstone was pruned before it could suppress the stale row —
 * so the merge kept the stale remote payment and the assertion flipped. The
 * product logic is correct; only the test's dependence on the real clock was
 * wrong.
 */
const NOW = new Date('2026-07-15T00:00:00.000Z');

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

function makePayment(id: string, overrides: Partial<Payment> = {}): Payment {
  return {
    id,
    cardId: 'card-1',
    period: '2026-07',
    amount: 100,
    paidOn: '2026-07-10',
    note: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<DriveSnapshot> = {}): DriveSnapshot {
  return {
    schemaVersion: 4,
    exportedAt: '2026-07-15T00:00:00.000Z',
    deviceId: 'device-local',
    settings: baseSettings(),
    cards: [],
    entries: [],
    payments: [],
    tombstones: [],
    ...overrides,
  };
}

describe('lwwMerge — payments', () => {
  it('unions payments present on only one side', () => {
    const local = makeSnapshot({ payments: [makePayment('p1')] });
    const remote = makeSnapshot({ payments: [makePayment('p2')] });
    const { snapshot } = lwwMerge(local, remote, { now: NOW });
    expect(snapshot.payments?.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('picks the newer payment by updatedAt (remote wins) and records a conflict', () => {
    const local = makeSnapshot({
      payments: [makePayment('p1', { amount: 100, updatedAt: '2026-07-10T00:00:00.000Z' })],
    });
    const remote = makeSnapshot({
      payments: [makePayment('p1', { amount: 175, updatedAt: '2026-07-12T00:00:00.000Z' })],
    });
    const { snapshot, conflictsResolved } = lwwMerge(local, remote, { now: NOW });
    expect(snapshot.payments?.find((p) => p.id === 'p1')?.amount).toBe(175);
    expect(conflictsResolved).toContainEqual(
      expect.objectContaining({ entityType: 'payment', entityId: 'p1', resolution: 'remote' }),
    );
  });

  it('a payment tombstone (deletedAt > updatedAt) wins over a stale remote edit', () => {
    // Device A deleted p1 at T2; device B still has a stale copy updated at T1.
    const local = makeSnapshot({
      payments: [],
      tombstones: [
        { entityId: 'p1', entityType: 'payment', deletedAt: '2026-07-12T00:00:00.000Z' },
      ],
    });
    const remote = makeSnapshot({
      payments: [makePayment('p1', { updatedAt: '2026-07-10T00:00:00.000Z' })],
    });
    const { snapshot, conflictsResolved } = lwwMerge(local, remote, { now: NOW });
    expect(snapshot.payments?.some((p) => p.id === 'p1')).toBe(false);
    expect(conflictsResolved).toContainEqual(
      expect.objectContaining({ entityType: 'payment', entityId: 'p1', resolution: 'tombstone' }),
    );
  });

  it('a re-created payment (updatedAt > tombstone.deletedAt) survives', () => {
    const local = makeSnapshot({
      payments: [makePayment('p1', { updatedAt: '2026-07-14T00:00:00.000Z' })],
    });
    const remote = makeSnapshot({
      tombstones: [
        { entityId: 'p1', entityType: 'payment', deletedAt: '2026-07-12T00:00:00.000Z' },
      ],
    });
    const { snapshot } = lwwMerge(local, remote, { now: NOW });
    expect(snapshot.payments?.some((p) => p.id === 'p1')).toBe(true);
  });

  it('carries payments when one side omits the field entirely (v3 snapshot)', () => {
    const localNoPayments = makeSnapshot();
    delete (localNoPayments as { payments?: unknown }).payments;
    const remote = makeSnapshot({ payments: [makePayment('p9')] });
    const { snapshot } = lwwMerge(localNoPayments, remote);
    expect(snapshot.payments?.map((p) => p.id)).toEqual(['p9']);
  });
});
