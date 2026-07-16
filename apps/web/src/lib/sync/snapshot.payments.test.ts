import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DriveSnapshot } from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import { createPayment, getAllPayments, initDB } from '@/lib/db/queries';

import { applySnapshot, buildSnapshot } from './snapshot';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-snap-pay-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

describe('snapshot v4 — payments', () => {
  it('buildSnapshot emits schemaVersion 4 and includes payments', async () => {
    await createPayment(db, {
      id: 'p1',
      cardId: 'c1',
      period: '2026-07',
      amount: 250,
      paidOn: '2026-07-15',
      note: null,
    });
    const snap = await buildSnapshot(db);
    expect(snap.schemaVersion).toBe(4);
    expect(snap.payments).toHaveLength(1);
    expect(snap.payments?.[0]).toMatchObject({ id: 'p1', amount: 250, period: '2026-07' });
  });

  it('round-trips payments through build -> apply into a fresh db', async () => {
    await createPayment(db, {
      id: 'p1',
      cardId: 'c1',
      period: '2026-07',
      amount: 100,
      paidOn: '2026-07-10',
      note: 'partial',
    });
    await createPayment(db, {
      id: 'p2',
      cardId: 'c1',
      period: '2026-07',
      amount: 150,
      paidOn: '2026-08-04',
      note: null,
    });
    const snap = await buildSnapshot(db);

    const db2 = new HourTrackDB(`hourtrack-snap-pay2-${Math.random().toString(36).slice(2)}`);
    await db2.open();
    await initDB(db2);
    const result = await applySnapshot(snap, db2);
    expect(result.payments).toBe(2);
    const applied = await getAllPayments(db2);
    expect(applied.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    await db2.delete();
  });

  it('applies a v3 snapshot (no payments field) with an empty payments store', async () => {
    // Seed a payment locally, then apply a legacy snapshot that omits payments
    // entirely — the store must be cleared to match the snapshot.
    await createPayment(db, {
      id: 'stale',
      cardId: 'c1',
      period: '2026-06',
      amount: 40,
      paidOn: '2026-06-01',
      note: null,
    });
    const v3Snapshot = {
      schemaVersion: 3,
      exportedAt: '2026-07-01T00:00:00.000Z',
      deviceId: 'device-x',
      settings: (await buildSnapshot(db)).settings,
      cards: [],
      entries: [],
      tombstones: [],
      // note: no `payments` key at all
    } as unknown as DriveSnapshot;

    const result = await applySnapshot(v3Snapshot, db);
    expect(result.payments).toBe(0);
    expect(await getAllPayments(db)).toHaveLength(0);
  });
});
