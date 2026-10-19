import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import type { MonthAdjustment } from '@/shared/types';

import {
  db,
  deleteMonthAdjustment,
  listMonthAdjustmentsByPeriod,
  setMonthAdjustment,
} from '@/lib/db';
import { useLiveRead, type LiveRead } from '@/lib/db/useLiveRead';
import { enqueueSync } from '@/features/sync/enqueueSync';

/**
 * Spec 011 — month adjustments: the hand-set expected amount for one card in
 * one month. Reads are live; writes fire-and-forget a Drive push like
 * payments do (the push rebuilds the whole snapshot, so no entityType).
 * Failures surface to the caller (the dialog toasts and stays open).
 */

function enqueueAdjustmentPush(mutation: 'update' | 'delete'): void {
  enqueueSync({ op: 'pushDataJson', mutation }, 'useMonthAdjustments');
}

export function useMonthAdjustmentsByPeriod(period: string): LiveRead<MonthAdjustment[]> {
  return useLiveRead(`monthAdjustments:${period}`, () => listMonthAdjustmentsByPeriod(db, period));
}

export type SetMonthAdjustmentInput = Pick<MonthAdjustment, 'cardId' | 'period' | 'amount'>;

export function useSetMonthAdjustmentMutation(): UseMutationResult<
  MonthAdjustment,
  Error,
  SetMonthAdjustmentInput
> {
  return useMutation({
    mutationFn: (input: SetMonthAdjustmentInput) => setMonthAdjustment(db, input),
    onSuccess: () => enqueueAdjustmentPush('update'),
  });
}

/** Reset to calculated: deletes the adjustment (with a tombstone). */
export function useDeleteMonthAdjustmentMutation(): UseMutationResult<
  MonthAdjustment | null,
  Error,
  string
> {
  return useMutation({
    mutationFn: (id: string) => deleteMonthAdjustment(db, id),
    onSuccess: () => enqueueAdjustmentPush('delete'),
  });
}
