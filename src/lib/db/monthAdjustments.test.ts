import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { monthAdjustmentId } from '@/shared/utils';

import { HourTrackDB } from './schema';
import {
  createCard,
  createPayment,
  deleteCardPermanently,
  deleteMonthAdjustment,
  getAllMonthAdjustments,
  getAllTombstones,
  initDB,
  listMonthAdjustmentsByPeriod,
  listMonthAdjustmentsInPeriods,
  setMonthAdjustment,
} from './queries';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-adj-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

describe('month adjustments — repo', () => {
  it('upserts one row per card+month with a deterministic id', async () => {
    const first = await setMonthAdjustment(db, { cardId: 'c1', period: '2026-10', amount: 200 });
    expect(first.id).toBe(monthAdjustmentId('c1', '2026-10'));
    expect(first.updatedAt).toBe(first.createdAt);

    await new Promise((r) => setTimeout(r, 2));
    const second = await setMonthAdjustment(db, { cardId: 'c1', period: '2026-10', amount: 180 });
    expect(second.amount).toBe(180);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt > first.updatedAt).toBe(true);
    expect(await getAllMonthAdjustments(db)).toHaveLength(1);
  });

  it('accepts 0 and rejects negative, non-finite or over-cap amounts', async () => {
    await expect(
      setMonthAdjustment(db, { cardId: 'c1', period: '2026-10', amount: 0 }),
    ).resolves.toMatchObject({ amount: 0 });
    for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001]) {
      await expect(
        setMonthAdjustment(db, { cardId: 'c1', period: '2026-10', amount }),
      ).rejects.toThrow(/amount/);
    }
  });

  it('rejects a malformed period', async () => {
    await expect(
      setMonthAdjustment(db, { cardId: 'c1', period: '2026-1', amount: 5 }),
    ).rejects.toThrow(/period/);
  });

  it('lists by period and by a period range', async () => {
    await setMonthAdjustment(db, { cardId: 'c1', period: '2026-09', amount: 1 });
    await setMonthAdjustment(db, { cardId: 'c1', period: '2026-10', amount: 2 });
    await setMonthAdjustment(db, { cardId: 'c2', period: '2026-10', amount: 3 });
    await setMonthAdjustment(db, { cardId: 'c1', period: '2026-12', amount: 4 });

    expect((await listMonthAdjustmentsByPeriod(db, '2026-10')).map((a) => a.amount)).toEqual([
      2, 3,
    ]);
    expect(
      (await listMonthAdjustmentsInPeriods(db, '2026-09', '2026-11')).map((a) => a.amount),
    ).toEqual([1, 2, 3]);
  });

  it('deletes with a tombstone', async () => {
    const adj = await setMonthAdjustment(db, { cardId: 'c1', period: '2026-10', amount: 200 });
    const deleted = await deleteMonthAdjustment(db, adj.id);
    expect(deleted?.id).toBe(adj.id);
    expect(await getAllMonthAdjustments(db)).toEqual([]);
    expect(await getAllTombstones(db)).toEqual([
      expect.objectContaining({ entityId: adj.id, entityType: 'monthAdjustment' }),
    ]);
    expect(await deleteMonthAdjustment(db, adj.id)).toBeNull();
  });

  it('a card hard-delete cascades its adjustments with tombstones', async () => {
    const card = await createCard(db, {
      id: 'card-casa',
      name: 'Casa',
      color: '#16A34A',
      defaultDurationMin: 240,
      defaultStartMinutes: 600,
      rateType: 'monthly',
      hourlyRate: null,
      fixedTotal: null,
      monthlyTotal: 250,
      defaultNote: null,
      isArchived: false,
      archivedAt: null,
    });
    await createPayment(db, {
      id: 'p1',
      cardId: card.id,
      period: '2026-10',
      amount: 200,
      paidOn: '2026-10-30',
      note: null,
    });
    const adj = await setMonthAdjustment(db, { cardId: card.id, period: '2026-10', amount: 200 });
    await setMonthAdjustment(db, { cardId: 'other', period: '2026-10', amount: 9 });

    await deleteCardPermanently(db, card.id);

    expect((await getAllMonthAdjustments(db)).map((a) => a.cardId)).toEqual(['other']);
    const tombstones = await getAllTombstones(db);
    expect(tombstones).toContainEqual(
      expect.objectContaining({ entityId: adj.id, entityType: 'monthAdjustment' }),
    );
  });
});
