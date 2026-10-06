import 'fake-indexeddb/auto';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Payment } from '@hourtrack/shared-types';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createPayment, deletePayment, initDB } from '@/lib/db';

import { usePaymentsByEntry } from './usePayments';

let testDb: HourTrackDB;
type DbModule = typeof dbModule;

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<DbModule>();
  return {
    ...actual,
    get db() {
      return testDb;
    },
  };
});

function newPayment(overrides: Partial<Payment>): Omit<Payment, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    cardId: 'card-1',
    period: '2026-07',
    amount: 42,
    paidOn: '2026-07-05',
    note: null,
    ...overrides,
  };
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-pbe-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('usePaymentsByEntry (010)', () => {
  it('maps each linked cleaning to its payment and follows writes live', async () => {
    await createPayment(testDb, newPayment({ id: 'unlinked' }));
    await createPayment(testDb, newPayment({ id: 'p1', entryId: 'e-1' }));

    const { result } = renderHook(() => usePaymentsByEntry());
    await waitFor(() => expect(result.current.data?.get('e-1')?.id).toBe('p1'));
    expect(result.current.data?.size).toBe(1);

    await act(async () => {
      await deletePayment(testDb, 'p1');
    });
    await waitFor(() => expect(result.current.data?.has('e-1')).toBe(false));
  });

  it('keeps the earliest payment when one cleaning has two', async () => {
    await createPayment(testDb, newPayment({ id: 'older', entryId: 'e-1' }));
    await new Promise((r) => setTimeout(r, 2));
    await createPayment(testDb, newPayment({ id: 'newer', entryId: 'e-1', amount: 50 }));

    const { result } = renderHook(() => usePaymentsByEntry());
    await waitFor(() => expect(result.current.data?.get('e-1')?.id).toBe('older'));
  });
});
