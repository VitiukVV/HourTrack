import { useEffect } from 'react';
import { useForm, type FieldErrors, type Resolver, type SubmitHandler } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Payment } from '@hourtrack/shared-types';
import { formatLocalDate } from '@hourtrack/shared-utils';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useZodMessageTranslator } from '@/lib/zodI18n';

import { PaymentFormSchema, type PaymentFormParsed } from './paymentSchema';
import {
  useCreatePaymentMutation,
  useDeletePaymentMutation,
  useUpdatePaymentMutation,
} from './usePayments';

/**
 * S27 — Mark-paid sheet.
 *
 * Create mode (no `payment`): amount prefilled with the remaining balance,
 * `paidOn` prefilled with today, optional note. One confirm creates the
 * payment and fires an Undo toast that deletes the just-created row.
 *
 * Edit mode (`payment` provided): the payment-history "edit" path reopens the
 * same dialog prefilled with the existing values and updates on confirm (no
 * undo toast — the history list already offers delete).
 */
interface FormShape {
  amount: number | null;
  paidOn: string;
  note: string;
}

const resolver: Resolver<FormShape, unknown, PaymentFormParsed> = async (values) => {
  const candidate = {
    amount:
      typeof values.amount === 'number' && Number.isFinite(values.amount) ? values.amount : NaN,
    paidOn: values.paidOn,
    note: values.note === '' ? null : values.note,
  };
  const result = PaymentFormSchema.safeParse(candidate);
  if (result.success) return { values: result.data, errors: {} };

  const errors: FieldErrors<FormShape> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '') as keyof FormShape;
    if (key && !errors[key]) {
      (errors as Record<string, { type: string; message: string }>)[key] = {
        type: 'zod',
        message: issue.message,
      };
    }
  }
  return { values: {} as never, errors };
};

export interface MarkPaidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardId: string;
  cardName: string;
  period: string;
  /** Remaining balance — the create-mode amount prefill. */
  remaining: number;
  /** When provided, the dialog is in edit mode for this payment. */
  payment?: Payment | null;
}

export function MarkPaidDialog({
  open,
  onOpenChange,
  cardId,
  cardName,
  period,
  remaining,
  payment,
}: MarkPaidDialogProps) {
  const { t } = useTranslation();
  const tMsg = useZodMessageTranslator('payments');

  const createPayment = useCreatePaymentMutation();
  const updatePayment = useUpdatePaymentMutation();
  const deletePayment = useDeletePaymentMutation();

  const isEdit = !!payment;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormShape, unknown, PaymentFormParsed>({
    resolver,
    mode: 'onSubmit',
    defaultValues: {
      amount: null,
      paidOn: formatLocalDate(new Date()),
      note: '',
    },
  });

  // Re-seed the form each time the dialog opens (or the target payment /
  // remaining changes). Create mode prefills the remaining balance rounded to
  // cents; edit mode prefills the existing payment.
  useEffect(() => {
    if (!open) return;
    if (payment) {
      reset({ amount: payment.amount, paidOn: payment.paidOn, note: payment.note ?? '' });
    } else {
      const prefill = remaining > 0 ? Number(remaining.toFixed(2)) : null;
      reset({ amount: prefill, paidOn: formatLocalDate(new Date()), note: '' });
    }
  }, [open, payment, remaining, reset]);

  const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

  const onValid: SubmitHandler<PaymentFormParsed> = (parsed) => {
    if (isEdit && payment) {
      updatePayment
        .mutateAsync({
          id: payment.id,
          patch: { amount: parsed.amount, paidOn: parsed.paidOn, note: parsed.note },
        })
        .then(() => onOpenChange(false))
        .catch((err: unknown) => {
          console.error('[MarkPaidDialog] updatePayment failed:', err);
          toast.error(t('payments.saveFailed'));
        });
      return;
    }

    createPayment
      .mutateAsync({
        id: crypto.randomUUID(),
        cardId,
        period,
        amount: parsed.amount,
        paidOn: parsed.paidOn,
        note: parsed.note,
      })
      .then((created) => {
        onOpenChange(false);
        toast.success(t('payments.marked', { amount: parsed.amount, card: cardName }), {
          action: {
            label: t('payments.undo'),
            onClick: () => {
              void deletePayment.mutateAsync(created.id).catch((err: unknown) => {
                console.warn('[MarkPaidDialog] undo failed', err);
              });
            },
          },
        });
      })
      .catch((err: unknown) => {
        console.error('[MarkPaidDialog] createPayment failed:', err);
        toast.error(t('payments.saveFailed'));
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="bottom-sheet" data-testid="mark-paid-dialog">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('payments.dialog.editTitle', { card: cardName })
              : t('payments.dialog.title', { card: cardName })}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onValid)} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mark-paid-amount" className="text-sm font-medium">
              {t('payments.dialog.amount')}
            </label>
            <Input
              id="mark-paid-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              onFocus={selectOnFocus}
              {...register('amount', {
                setValueAs: (v: unknown) => {
                  if (v === '' || v === null || v === undefined) return null;
                  const n = typeof v === 'number' ? v : Number(v);
                  return Number.isNaN(n) ? null : n;
                },
              })}
            />
            {errors.amount?.message && (
              <p className="text-destructive text-xs" role="alert">
                {tMsg(errors.amount.message)}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="mark-paid-date" className="text-sm font-medium">
              {t('payments.dialog.paidOn')}
            </label>
            <Input id="mark-paid-date" type="date" className="w-44" {...register('paidOn')} />
            {errors.paidOn?.message && (
              <p className="text-destructive text-xs" role="alert">
                {tMsg(errors.paidOn.message)}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="mark-paid-note" className="text-sm font-medium">
              {t('payments.dialog.note')}
            </label>
            <Input
              id="mark-paid-note"
              type="text"
              autoComplete="off"
              placeholder={t('payments.dialog.notePlaceholder')}
              {...register('note')}
            />
          </div>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting} data-testid="mark-paid-confirm">
              {t('common.confirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
