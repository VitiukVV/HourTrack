import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { useMemo } from 'react';

import type { Card, Payment } from '@hourtrack/shared-types';
import { endOfMonth, formatLocalDate, startOfMonth } from '@hourtrack/shared-utils';

import {
  createPayment,
  db,
  deletePayment,
  getEntriesByDateRange,
  listPaymentsByPeriod,
  updatePayment,
} from '@/lib/db';
import { useLiveRead, type LiveRead } from '@/lib/db/useLiveRead';
import { useAllCardsQuery } from '@/features/cards/useCards';
import { getSyncManager } from '@/features/sync/SyncManager';

import {
  computeMonthLedger,
  ledgerTotals,
  type LedgerTotals,
  type MonthLedgerRow,
} from './monthLedger';

/**
 * Hooks for Payments (S27). Mirrors the `useCards` pattern: each hook wraps a
 * pure `db`-first query function and passes the singleton `db`. Reads are
 * live (spec 006); mutations write, then fire-and-forget a Drive push. Payments NEVER touch Google Calendar — no calendar ops here.
 */

/**
 * Notify the SyncManager that a payment change should be pushed to Drive.
 * Fire-and-forget. `entityType` is intentionally omitted: the sync-queue
 * `entityType` union is `'card' | 'entry'`, and the `pushDataJson` op rebuilds
 * the whole snapshot from Dexie anyway, so the payment write is already
 * captured — the enqueue only needs to schedule a push.
 */
function enqueuePaymentPush(mutation: 'create' | 'update' | 'delete'): void {
  void getSyncManager()
    .enqueue({ op: 'pushDataJson', mutation })
    .catch((err: unknown) => {
      console.warn('[usePayments] enqueue sync failed', err);
    });
}

export function usePaymentsByPeriodQuery(period: string): LiveRead<Payment[]> {
  return useLiveRead(`payments:${period}`, () => listPaymentsByPeriod(db, period));
}

export interface MonthLedgerResult {
  rows: MonthLedgerRow[];
  totals: LedgerTotals;
  cards: Card[];
}

/**
 * Compose the full month ledger: (active + archived) cards + the month's
 * entries + the period's payments → `computeMonthLedger`. The three sources
 * are independent live reads, so a payment write only re-reads payments and
 * the ledger recomputes purely in memory.
 */
export function useMonthLedger(period: string): {
  data: MonthLedgerResult | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const cardsQuery = useAllCardsQuery(true);

  const { start, end } = useMemo(() => {
    const anchor = parseISO(`${period}-01`);
    return {
      start: formatLocalDate(startOfMonth(anchor)),
      end: formatLocalDate(endOfMonth(anchor)),
    };
  }, [period]);

  const entriesQuery = useLiveRead(`entries:${start}..${end}`, () =>
    getEntriesByDateRange(db, start, end),
  );

  const paymentsQuery = usePaymentsByPeriodQuery(period);

  const data = useMemo<MonthLedgerResult | undefined>(() => {
    if (!cardsQuery.data || !entriesQuery.data || !paymentsQuery.data) return undefined;
    const rows = computeMonthLedger(cardsQuery.data, entriesQuery.data, paymentsQuery.data, period);
    return { rows, totals: ledgerTotals(rows), cards: cardsQuery.data };
  }, [cardsQuery.data, entriesQuery.data, paymentsQuery.data, period]);

  return {
    data,
    isLoading: cardsQuery.isLoading || entriesQuery.isLoading || paymentsQuery.isLoading,
    isError: cardsQuery.isError || entriesQuery.isError || paymentsQuery.isError,
  };
}

type PaymentCreateInput = Omit<Payment, 'createdAt' | 'updatedAt'>;

export function useCreatePaymentMutation(): UseMutationResult<Payment, Error, PaymentCreateInput> {
  return useMutation({
    mutationFn: (input: PaymentCreateInput) => createPayment(db, input),
    onSuccess: () => enqueuePaymentPush('create'),
  });
}

interface UpdatePaymentArgs {
  id: string;
  patch: Partial<Omit<Payment, 'id' | 'createdAt' | 'updatedAt'>>;
}

export function useUpdatePaymentMutation(): UseMutationResult<Payment, Error, UpdatePaymentArgs> {
  return useMutation({
    mutationFn: ({ id, patch }: UpdatePaymentArgs) => updatePayment(db, id, patch),
    onSuccess: () => enqueuePaymentPush('update'),
  });
}

/**
 * Delete a payment. Used both by the undo-toast (right after create) and by
 * the payment-history delete affordance. Returns the deleted row (or null).
 */
export function useDeletePaymentMutation(): UseMutationResult<Payment | null, Error, string> {
  return useMutation({
    mutationFn: (id: string) => deletePayment(db, id),
    onSuccess: () => enqueuePaymentPush('delete'),
  });
}
