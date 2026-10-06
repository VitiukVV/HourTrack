import type { Payment } from '@hourtrack/shared-types';

import type { HourTrackDB } from '../schema';
import { deleteWithTombstone, nowIso, patchRow } from '../mutate';

/**
 * ALL payments across every card + period. Used by the S27 snapshot builder
 * so payments ride the Drive `data.json` sync. Sorted by `id` for a stable,
 * deterministic ordering (snapshot round-trip tests depend on it).
 */
export async function getAllPayments(db: HourTrackDB): Promise<Payment[]> {
  const rows = await db.payments.toArray();
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

/** `paidOn` ascending, then `createdAt` as a stable tiebreaker. */
function compareByPaidOn(a: Payment, b: Payment): number {
  if (a.paidOn !== b.paidOn) return a.paidOn < b.paidOn ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : 1;
}

/**
 * Every payment recorded for `period` (`'YYYY-MM'`), across all cards. Drives
 * the Payments page's per-month view. Sorted by `paidOn` ascending, then
 * `createdAt` as a stable tiebreaker.
 */
export async function listPaymentsByPeriod(db: HourTrackDB, period: string): Promise<Payment[]> {
  const rows = await db.payments.where('period').equals(period).toArray();
  rows.sort(compareByPaidOn);
  return rows;
}

/**
 * Payments for one card in one period, via the `[cardId+period]` compound
 * index. `received` for a ledger row = sum of `amount` across this set.
 * Sorted by `paidOn` ascending, then `createdAt`.
 */
export async function listPaymentsForCardPeriod(
  db: HourTrackDB,
  cardId: string,
  period: string,
): Promise<Payment[]> {
  const rows = await db.payments.where('[cardId+period]').equals([cardId, period]).toArray();
  rows.sort(compareByPaidOn);
  return rows;
}

/**
 * Every payment recorded from a cleaning's card (spec 010) — the rows with a
 * non-empty `entryId`. Oldest `createdAt` first, so a caller keying them by
 * entry can keep the first one when two devices both linked the same cleaning.
 * A full scan: payments are a few hundred rows at most, not worth an index.
 */
export async function listEntryLinkedPayments(db: HourTrackDB): Promise<Payment[]> {
  const rows = await db.payments.filter((p) => !!p.entryId).toArray();
  rows.sort((a, b) =>
    a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : 1,
  );
  return rows;
}

export async function createPayment(
  db: HourTrackDB,
  input: Omit<Payment, 'createdAt' | 'updatedAt'>,
): Promise<Payment> {
  if (!(input.amount > 0)) {
    throw new Error(`createPayment: amount must be > 0, got ${input.amount}`);
  }
  const now = nowIso();
  const payment: Payment = { ...input, createdAt: now, updatedAt: now };
  await db.payments.add(payment);
  return payment;
}

/**
 * Apply a partial patch and stamp a fresh `updatedAt`. Throws if the payment
 * does not exist. `amount` (when present) must stay > 0.
 */
export async function updatePayment(
  db: HourTrackDB,
  id: string,
  patch: Partial<Omit<Payment, 'id' | 'createdAt'>>,
): Promise<Payment> {
  // S31 (UR-31-4): atomic get→merge→put in one `rw` transaction (see updateCard).
  return patchRow(db.payments, id, patch, 'updatePayment: payment not found', (next) => {
    if (!(next.amount > 0)) {
      throw new Error(`updatePayment: amount must be > 0, got ${next.amount}`);
    }
  });
}

/**
 * Delete a payment and record a tombstone (`entityType: 'payment'`). The
 * tombstone is what propagates the delete to other devices via the next Drive
 * snapshot — without it a remote device would treat the absence as "not yet
 * synced" and re-add its stale copy. Idempotent: returns `null` if the
 * payment didn't exist.
 */
export async function deletePayment(db: HourTrackDB, id: string): Promise<Payment | null> {
  return deleteWithTombstone(db, db.payments, 'payment', id);
}
