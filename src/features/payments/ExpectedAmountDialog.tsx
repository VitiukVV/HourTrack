import { useEffect, useRef } from 'react';
import { useForm, type FieldErrors, type Resolver, type SubmitHandler } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { monthAdjustmentId } from '@/shared/utils';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatMonthName } from '@/lib/i18n/calendarLocale';
import { useZodMessageTranslator } from '@/lib/i18n/zodI18n';
import { noAutofill } from '@/lib/utils/noAutofill';

import { formatEur } from './formatEur';
import { ExpectedAmountSchema, type ExpectedAmountParsed } from './paymentSchema';
import {
  useDeleteMonthAdjustmentMutation,
  useSetMonthAdjustmentMutation,
} from './useMonthAdjustments';

/**
 * Spec 011 — set the amount expected from one card for one month, from its
 * Payments row. Saving writes a month adjustment; «Reset to calculated»
 * (only when the month is adjusted) removes it. The card rate and every other
 * month are untouched. A failed write toasts and keeps the sheet open.
 */
interface FormShape {
  amount: number | null;
}

const resolver: Resolver<FormShape, unknown, ExpectedAmountParsed> = async (values) => {
  const amount =
    typeof values.amount === 'number' && Number.isFinite(values.amount) ? values.amount : NaN;
  const result = ExpectedAmountSchema.safeParse({ amount });
  if (result.success) return { values: result.data, errors: {} };
  const message = result.error.issues[0]?.message ?? 'payments.validation.amountRequired';
  const errors: FieldErrors<FormShape> = { amount: { type: 'zod', message } };
  return { values: {} as never, errors };
};

export interface ExpectedAmountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardId: string;
  cardName: string;
  period: string;
  /** The row's current expected amount — the prefill. */
  expected: number;
  /** What the card rate gives for the month. */
  calculated: number;
  /** Whether a month adjustment currently sets `expected`. */
  adjusted: boolean;
}

export function ExpectedAmountDialog({
  open,
  onOpenChange,
  cardId,
  cardName,
  period,
  expected,
  calculated,
  adjusted,
}: ExpectedAmountDialogProps) {
  const { t, i18n } = useTranslation();
  const tMsg = useZodMessageTranslator('payments');
  const setAdjustment = useSetMonthAdjustmentMutation();
  const deleteAdjustment = useDeleteMonthAdjustmentMutation();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormShape, unknown, ExpectedAmountParsed>({
    resolver,
    mode: 'onSubmit',
    defaultValues: { amount: expected },
  });

  // Seed the form when the sheet opens — not on every `expected` change, or a
  // sync pull landing mid-edit would overwrite what the user is typing.
  const expectedRef = useRef(expected);
  useEffect(() => {
    expectedRef.current = expected;
  }, [expected]);
  useEffect(() => {
    if (open) reset({ amount: expectedRef.current });
  }, [open, reset]);

  const failed = (err: unknown) => {
    console.error('[ExpectedAmountDialog] write failed:', err);
    toast.error(t('common.saveFailed'));
  };

  const onValid: SubmitHandler<ExpectedAmountParsed> = (parsed) =>
    setAdjustment
      .mutateAsync({ cardId, period, amount: parsed.amount })
      .then(() => onOpenChange(false))
      .catch(failed);

  const handleReset = () => {
    deleteAdjustment
      .mutateAsync(monthAdjustmentId(cardId, period))
      .then(() => onOpenChange(false))
      .catch(failed);
  };

  const busy = isSubmitting || setAdjustment.isPending || deleteAdjustment.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="bottom-sheet" data-testid="expected-amount-dialog">
        <DialogHeader>
          <DialogTitle>
            {t('payments.expected.title', {
              card: cardName,
              month: formatMonthName(period, i18n.language),
            })}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onValid)} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="expected-amount" className="text-sm font-medium">
              {t('payments.expected.amount')}
            </label>
            <Input
              {...noAutofill('expected-amount')}
              id="expected-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              onFocus={(e) => e.target.select()}
              {...register('amount', {
                setValueAs: (v: unknown) => {
                  if (v === '' || v === null || v === undefined) return null;
                  const n = typeof v === 'number' ? v : Number(v);
                  return Number.isNaN(n) ? null : n;
                },
              })}
            />
            <p className="text-muted-foreground text-xs">
              {t('payments.expected.calculatedHint', { amount: formatEur(calculated) })}
            </p>
            {errors.amount?.message && (
              <p className="text-destructive text-xs" role="alert">
                {tMsg(errors.amount.message)}
              </p>
            )}
          </div>

          <div className="mt-2 flex justify-end gap-2">
            {adjusted && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mr-auto"
                disabled={busy}
                onClick={handleReset}
                data-testid="expected-amount-reset"
              >
                {t('payments.expected.reset')}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={busy} data-testid="expected-amount-save">
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
