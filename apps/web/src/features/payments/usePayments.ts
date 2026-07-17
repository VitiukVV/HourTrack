import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { useMemo } from 'react';

import type { Card, Entry, Payment } from '@hourtrack/shared-types';
import { endOfMonth, formatLocalDate, startOfMonth } from '@hourtrack/shared-utils';

import {
  createPayment,
  db,
  deletePayment,
  getEntriesByDateRange,
  listPaymentsByPeriod,
  updatePayment,
} from '@/lib/db';
import { useAllCardsQuery } from '@/features/cards/useCards';
import { getSyncManager } from '@/features/sync/SyncManager';

import {
  computeMonthLedger,
  ledgerTotals,
  type LedgerTotals,
  type MonthLedgerRow,
} from './monthLedger';

/**
 * TanStack Query hooks for Payments (S27). Mirrors the `useCards` pattern:
 * each hook wraps a pure `db`-first query function and passes the singleton
 * `db`; mutations write optimistically, invalidate, then fire-and-forget a
 * Drive push. Payments NEVER touch Google Calendar — no calendar ops here.
 */

export const PAYMENTS_QUERY_KEY = ['payments'] as const;
const periodKey = (period: string) => ['payments', 'period', period] as const;

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

export function usePaymentsByPeriodQuery(period: string): UseQueryResult<Payment[]> {
  return useQuery({
    queryKey: periodKey(period),
    queryFn: () => listPaymentsByPeriod(db, period),
  });
}

export interface MonthLedgerResult {
  rows: MonthLedgerRow[];
  totals: LedgerTotals;
  cards: Card[];
}

/**
 * Compose the full month ledger: (active + archived) cards + the month's
 * entries + the period's payments → `computeMonthLedger`. The three sources
 * are independent queries so a payment mutation only re-reads payments (the
 * entries/cards caches stay warm), and the ledger recomputes purely in memory.
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

  const entriesQuery = useQuery<Entry[]>({
    queryKey: ['entries', 'range', 'payments', start, end],
    queryFn: () => getEntriesByDateRange(db, start, end),
  });

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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PaymentCreateInput) => createPayment(db, input),
    onSuccess: (created) => {
      // Write straight into the period cache so the chip flips without a full
      // refetch, then invalidate for consistency.
      qc.setQueryData<Payment[]>(periodKey(created.period), (old) =>
        old ? [...old, created] : [created],
      );
      void qc.invalidateQueries({ queryKey: PAYMENTS_QUERY_KEY });
      enqueuePaymentPush('create');
    },
  });
}

interface UpdatePaymentArgs {
  id: string;
  patch: Partial<Omit<Payment, 'id' | 'createdAt' | 'updatedAt'>>;
}

export function useUpdatePaymentMutation(): UseMutationResult<Payment, Error, UpdatePaymentArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdatePaymentArgs) => updatePayment(db, id, patch),
    onSuccess: (updated) => {
      qc.setQueryData<Payment[]>(periodKey(updated.period), (old) =>
        old?.map((p) => (p.id === updated.id ? updated : p)),
      );
      void qc.invalidateQueries({ queryKey: PAYMENTS_QUERY_KEY });
      enqueuePaymentPush('update');
    },
  });
}

/**
 * Delete a payment. Used both by the undo-toast (right after create) and by
 * the payment-history delete affordance. Returns the deleted row (or null).
 */
export function useDeletePaymentMutation(): UseMutationResult<Payment | null, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePayment(db, id),
    onSuccess: (deleted) => {
      if (deleted) {
        qc.setQueryData<Payment[]>(periodKey(deleted.period), (old) =>
          old?.filter((p) => p.id !== deleted.id),
        );
      }
      void qc.invalidateQueries({ queryKey: PAYMENTS_QUERY_KEY });
      enqueuePaymentPush('delete');
    },
  });
}
