import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DriveSnapshot, MonthAdjustment, Settings } from '@/shared/types';

import { HourTrackDB } from '@/lib/db/schema';
import {
  deleteMonthAdjustment,
  getAllMonthAdjustments,
  initDB,
  setMonthAdjustment,
} from '@/lib/db/queries';
import { lwwMerge } from '@/features/sync/lwwMerge';

import { applySnapshot, buildSnapshot } from './snapshot';
import { validatePulledSnapshot, validateSnapshot } from './validateSnapshot';

let db: HourTrackDB;

function freshDb(tag: string): HourTrackDB {
  return new HourTrackDB(`hourtrack-snap-adj-${tag}-${Math.random().toString(36).slice(2)}`);
}

beforeEach(async () => {
  db = freshDb('a');
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

const NOW = new Date('2026-10-19T12:00:00.000Z');

function settings(): Settings {
  return {
    language: 'uk',
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

function adj(amount: number, updatedAt: string): MonthAdjustment {
  return {
    id: 'c1:2026-10',
    cardId: 'c1',
    period: '2026-10',
    amount,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt,
  };
}

function snap(overrides: Partial<DriveSnapshot> = {}): DriveSnapshot {
  return {
    schemaVersion: 7,
    exportedAt: '2026-10-19T00:00:00.000Z',
    deviceId: 'dev',
    settings: settings(),
    cards: [],
    entries: [],
    payments: [],
    reminders: [],
    monthAdjustments: [],
    tombstones: [],
    ...overrides,
  };
}

describe('snapshot v7 — month adjustments', () => {
  it('buildSnapshot emits v7 with adjustments and round-trips into a fresh db', async () => {
    await setMonthAdjustment(db, { cardId: 'c1', period: '2026-10', amount: 200 });
    const built = await buildSnapshot(db);
    expect(built.schemaVersion).toBe(7);
    expect(built.monthAdjustments).toEqual([
      expect.objectContaining({ id: 'c1:2026-10', amount: 200 }),
    ]);

    const validated = validateSnapshot(JSON.parse(JSON.stringify(built)));
    expect(validated.ok).toBe(true);

    const db2 = freshDb('b');
    await db2.open();
    await initDB(db2);
    const result = await applySnapshot(built, db2);
    expect(result.monthAdjustments).toBe(1);
    expect((await getAllMonthAdjustments(db2))[0]).toMatchObject({ amount: 200 });
    await db2.delete();
  });

  it('a v6 snapshot validates with an empty adjustments list', () => {
    const v6 = { ...snap(), schemaVersion: 6 } as Record<string, unknown>;
    delete v6.monthAdjustments;
    const result = validateSnapshot(v6);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.schemaVersion).toBe(7);
      expect(result.snapshot.monthAdjustments).toEqual([]);
    }
  });

  it('rejects a negative adjustment amount', () => {
    const result = validateSnapshot(snap({ monthAdjustments: [adj(-1, NOW.toISOString())] }));
    expect(result.ok).toBe(false);
  });

  it('replace-mode restore wipes adjustments the backup does not have', async () => {
    await setMonthAdjustment(db, { cardId: 'c1', period: '2026-10', amount: 200 });
    await applySnapshot(snap(), db);
    expect(await getAllMonthAdjustments(db)).toEqual([]);
  });

  it('lwwMerge keeps the later edit of the same month', () => {
    const local = snap({ monthAdjustments: [adj(200, '2026-10-10T00:00:00.000Z')] });
    const remote = snap({ monthAdjustments: [adj(180, '2026-10-11T00:00:00.000Z')] });
    const { snapshot } = lwwMerge(local, remote, { now: NOW });
    expect(snapshot.monthAdjustments).toEqual([expect.objectContaining({ amount: 180 })]);
  });

  it('a reset (tombstone) on one device is not revived by an older copy', () => {
    const local = snap({
      tombstones: [
        {
          entityId: 'c1:2026-10',
          entityType: 'monthAdjustment',
          deletedAt: '2026-10-12T00:00:00.000Z',
        },
      ],
    });
    const remote = snap({ monthAdjustments: [adj(200, '2026-10-10T00:00:00.000Z')] });
    const { snapshot } = lwwMerge(local, remote, { now: NOW });
    expect(snapshot.monthAdjustments).toEqual([]);
  });

  it('setting the month again after a reset survives the merge', () => {
    const local = snap({
      monthAdjustments: [adj(150, '2026-10-13T00:00:00.000Z')],
      tombstones: [
        {
          entityId: 'c1:2026-10',
          entityType: 'monthAdjustment',
          deletedAt: '2026-10-12T00:00:00.000Z',
        },
      ],
    });
    const { snapshot } = lwwMerge(local, snap(), { now: NOW });
    expect(snapshot.monthAdjustments).toEqual([expect.objectContaining({ amount: 150 })]);
  });

  it('merge-mode apply drops a local row covered by a newer remote tombstone', async () => {
    const row = await setMonthAdjustment(db, { cardId: 'c1', period: '2026-10', amount: 200 });
    const later = new Date(Date.parse(row.updatedAt) + 1000).toISOString();
    await applySnapshot(
      snap({ tombstones: [{ entityId: row.id, entityType: 'monthAdjustment', deletedAt: later }] }),
      db,
      { mode: 'merge' },
    );
    expect(await getAllMonthAdjustments(db)).toEqual([]);
    // And a local reset is recorded for the next push.
    await setMonthAdjustment(db, { cardId: 'c1', period: '2026-11', amount: 5 });
    await deleteMonthAdjustment(db, 'c1:2026-11');
    const built = await buildSnapshot(db);
    expect(built.tombstones).toContainEqual(
      expect.objectContaining({ entityId: 'c1:2026-11', entityType: 'monthAdjustment' }),
    );
  });

  it.each([
    ['a non-array field', { monthAdjustments: {} }],
    ['a null field', { monthAdjustments: null }],
    [
      'an id that is not cardId:period',
      { monthAdjustments: [{ ...adj(200, NOW.toISOString()), id: 'x' }] },
    ],
    [
      'month 13',
      {
        monthAdjustments: [{ ...adj(200, NOW.toISOString()), id: 'c1:2026-13', period: '2026-13' }],
      },
    ],
    ['an amount over the cap', { monthAdjustments: [adj(1_000_001, NOW.toISOString())] }],
  ])('rejects a v7 file with %s instead of papering over it', (_label, overrides) => {
    const result = validateSnapshot({ ...snap(), ...overrides });
    expect(result.ok).toBe(false);
  });

  it('a reset reaches the other device through the real pull pipeline', async () => {
    // Device B already holds the adjustment.
    const dbB = freshDb('b');
    await dbB.open();
    await initDB(dbB);
    await setMonthAdjustment(dbB, { cardId: 'c1', period: '2026-10', amount: 200 });
    // Device A had it too and resets it later.
    await setMonthAdjustment(db, { cardId: 'c1', period: '2026-10', amount: 200 });
    await new Promise((r) => setTimeout(r, 5));
    await deleteMonthAdjustment(db, 'c1:2026-10');

    const pulled = validatePulledSnapshot(JSON.parse(JSON.stringify(await buildSnapshot(db))));
    expect(pulled.tombstones).toContainEqual(
      expect.objectContaining({ entityId: 'c1:2026-10', entityType: 'monthAdjustment' }),
    );
    const { snapshot: merged } = lwwMerge(await buildSnapshot(dbB), pulled);
    await applySnapshot(merged, dbB, { mode: 'merge' });
    expect(await getAllMonthAdjustments(dbB)).toEqual([]);
    await dbB.delete();
  });
});
