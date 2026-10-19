import type { MonthAdjustment } from '@/shared/types';
import { monthAdjustmentId } from '@/shared/utils';

import type { HourTrackDB } from '../schema';
import { deleteWithTombstone, nowIso } from '../mutate';

/** Upper bound for a hand-set expected amount (spec 011 edge cases). */
export const MONTH_ADJUSTMENT_MAX = 1_000_000;

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Card name order is the caller's job; here rows sort by period, then card id. */
function compareByPeriodThenCard(a: MonthAdjustment, b: MonthAdjustment): number {
  if (a.period !== b.period) return a.period < b.period ? -1 : 1;
  return a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0;
}

/**
 * ALL adjustments. Used by the snapshot builder so adjustments ride the Drive
 * `data.json` sync. Sorted by `id` for a deterministic snapshot.
 */
export async function getAllMonthAdjustments(db: HourTrackDB): Promise<MonthAdjustment[]> {
  const rows = await db.monthAdjustments.toArray();
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

/** Adjustments for one `'YYYY-MM'` period, across all cards (Payments page). */
export async function listMonthAdjustmentsByPeriod(
  db: HourTrackDB,
  period: string,
): Promise<MonthAdjustment[]> {
  const rows = await db.monthAdjustments.where('period').equals(period).toArray();
  rows.sort(compareByPeriodThenCard);
  return rows;
}

/** Adjustments for every period in `[from, to]` inclusive (Reports range). */
export async function listMonthAdjustmentsInPeriods(
  db: HourTrackDB,
  from: string,
  to: string,
): Promise<MonthAdjustment[]> {
  const rows = await db.monthAdjustments.where('period').between(from, to, true, true).toArray();
  rows.sort(compareByPeriodThenCard);
  return rows;
}

/**
 * Set the expected amount for one card+month: creates the row, or updates it
 * in place keeping `createdAt`. Throws on a malformed period or an amount
 * outside `[0, MONTH_ADJUSTMENT_MAX]`.
 */
export async function setMonthAdjustment(
  db: HourTrackDB,
  input: Pick<MonthAdjustment, 'cardId' | 'period' | 'amount'>,
): Promise<MonthAdjustment> {
  const { cardId, period, amount } = input;
  if (!PERIOD_RE.test(period)) {
    throw new Error(`setMonthAdjustment: period must be YYYY-MM, got ${period}`);
  }
  if (!Number.isFinite(amount) || amount < 0 || amount > MONTH_ADJUSTMENT_MAX) {
    throw new Error(`setMonthAdjustment: amount out of range: ${amount}`);
  }
  const id = monthAdjustmentId(cardId, period);
  return db.transaction('rw', db.monthAdjustments, async () => {
    const existing = await db.monthAdjustments.get(id);
    const now = nowIso();
    const row: MonthAdjustment = {
      id,
      cardId,
      period,
      amount,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db.monthAdjustments.put(row);
    return row;
  });
}

/**
 * Remove an adjustment ("reset to calculated") and record a
 * `monthAdjustment` tombstone so other devices drop their copy too. Returns
 * the deleted row, or `null` when there was none (idempotent).
 */
export async function deleteMonthAdjustment(
  db: HourTrackDB,
  id: string,
): Promise<MonthAdjustment | null> {
  return deleteWithTombstone(db, db.monthAdjustments, 'monthAdjustment', id);
}
