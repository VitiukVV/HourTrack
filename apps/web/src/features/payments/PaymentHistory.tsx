import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Payment } from '@hourtrack/shared-types';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/date';

import { useDeletePaymentMutation } from './usePayments';

/**
 * S27 — expanded per-row payment history. Lists every payment for the card in
 * the selected month; each shows amount + paidOn + note with edit (reopens the
 * MarkPaidDialog prefilled) and delete (confirm → tombstoned delete). This is
 * the permanent correction mechanism beyond the toast-undo window.
 */
export interface PaymentHistoryProps {
  payments: Payment[];
  onEdit: (payment: Payment) => void;
}

export function PaymentHistory({ payments, onEdit }: PaymentHistoryProps) {
  const { t } = useTranslation();
  const deletePayment = useDeletePaymentMutation();
  const [pendingDelete, setPendingDelete] = useState<Payment | null>(null);

  if (payments.length === 0) {
    return (
      <p className="text-muted-foreground px-1 py-2 text-xs" data-testid="payment-history-empty">
        {t('payments.history.empty')}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1" data-testid="payment-history">
      {payments.map((p) => (
        <li
          key={p.id}
          className="border-border/60 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
          data-testid="payment-history-item"
        >
          <div className="flex min-w-0 flex-col">
            <span className="font-medium">{p.amount} €</span>
            <span className="text-muted-foreground text-xs">
              {formatDate(p.paidOn)}
              {p.note ? ` · ${p.note}` : ''}
            </span>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onEdit(p)}
              data-testid="payment-history-edit"
            >
              {t('common.edit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setPendingDelete(p)}
              data-testid="payment-history-delete"
            >
              {t('payments.history.delete')}
            </Button>
          </div>
        </li>
      ))}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title={t('payments.history.confirmDelete.title')}
        body={t('payments.history.confirmDelete.body')}
        confirmLabel={t('payments.history.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="destructive"
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (!target) return;
          void deletePayment.mutateAsync(target.id).catch((err: unknown) => {
            console.error('[PaymentHistory] delete failed', err);
          });
        }}
      />
    </ul>
  );
}
