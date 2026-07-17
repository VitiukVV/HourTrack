import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Payment } from '@hourtrack/shared-types';

import { HourTrackDB } from './schema';
import {
  createPayment,
  deletePayment,
  getAllPayments,
  getAllTombstones,
  initDB,
  listPaymentsByPeriod,
  listPaymentsForCardPeriod,
  updatePayment,
} from './queries';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-pay-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

function newPayment(overrides: Partial<Payment> = {}): Omit<Payment, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    cardId: 'card-1',
    period: '2026-07',
    amount: 250,
    paidOn: '2026-07-15',
    note: null,
    ...overrides,
  };
}

describe('payment queries — CRUD round-trip', () => {
  it('creates, stamps timestamps, and reads back a payment', async () => {
    const created = await createPayment(db, newPayment());
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBe(created.createdAt);

    const all = await getAllPayments(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ cardId: 'card-1', period: '2026-07', amount: 250 });
  });

  it('rejects a non-positive amount on create', async () => {
    await expect(createPayment(db, newPayment({ amount: 0 }))).rejects.toThrow(
      /amount must be > 0/,
    );
    await expect(createPayment(db, newPayment({ amount: -5 }))).rejects.toThrow(
      /amount must be > 0/,
    );
  });

  it('updates a payment and bumps updatedAt', async () => {
    const created = await createPayment(db, newPayment({ amount: 100 }));
    // Ensure a later timestamp is observable.
    await new Promise((r) => setTimeout(r, 2));
    const updated = await updatePayment(db, created.id, { amount: 120, note: 'partial' });
    expect(updated.amount).toBe(120);
    expect(updated.note).toBe('partial');
    expect(updated.updatedAt >= created.updatedAt).toBe(true);
  });

  it('rejects an update that would set a non-positive amount', async () => {
    const created = await createPayment(db, newPayment());
    await expect(updatePayment(db, created.id, { amount: 0 })).rejects.toThrow(
      /amount must be > 0/,
    );
  });

  it('lists by period and by [cardId+period] compound index', async () => {
    await createPayment(db, newPayment({ cardId: 'a', period: '2026-07', amount: 50 }));
    await createPayment(db, newPayment({ cardId: 'a', period: '2026-07', amount: 60 }));
    await createPayment(db, newPayment({ cardId: 'b', period: '2026-07', amount: 70 }));
    await createPayment(db, newPayment({ cardId: 'a', period: '2026-08', amount: 80 }));

    const july = await listPaymentsByPeriod(db, '2026-07');
    expect(july).toHaveLength(3);

    const aJuly = await listPaymentsForCardPeriod(db, 'a', '2026-07');
    expect(aJuly).toHaveLength(2);
    expect(aJuly.reduce((s, p) => s + p.amount, 0)).toBe(110);

    const aAug = await listPaymentsForCardPeriod(db, 'a', '2026-08');
    expect(aAug).toHaveLength(1);
  });
});

describe('payment delete — tombstone', () => {
  it('deletes the payment and writes a payment tombstone', async () => {
    const created = await createPayment(db, newPayment());
    const deleted = await deletePayment(db, created.id);
    expect(deleted?.id).toBe(created.id);

    expect(await getAllPayments(db)).toHaveLength(0);

    const tombstones = await getAllTombstones(db);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]).toMatchObject({ entityId: created.id, entityType: 'payment' });
    expect(tombstones[0]?.deletedAt).toBeTruthy();
  });

  it('is idempotent — deleting a missing payment returns null and writes no tombstone', async () => {
    const result = await deletePayment(db, 'does-not-exist');
    expect(result).toBeNull();
    expect(await getAllTombstones(db)).toHaveLength(0);
  });
});
