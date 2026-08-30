import { useEffect } from 'react';
import {
  Controller,
  useForm,
  type FieldErrors,
  type Resolver,
  type SubmitHandler,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Reminder } from '@hourtrack/shared-types';
import { formatLocalDate } from '@hourtrack/shared-utils';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TimeInput } from '@/components/ui/TimeInput';
import { useZodMessageTranslator } from '@/lib/zodI18n';

import { ReminderFormSchema, type ReminderFormParsed } from './reminderSchema';
import { useCreateReminderMutation, useUpdateReminderMutation } from './useReminders';
import { noAutofill } from '@/lib/noAutofill';

/**
 * S28 — create / edit reminder dialog.
 *
 * Create mode (no `reminder`): blank text, date defaults to today (or the
 * `prefill` date), time defaults to 09:00 (or `prefill` time). The Payments
 * "Нагадати" quick-create passes a `prefill` with the collect-payment text +
 * tomorrow's date (UR-28-4) — prefill only, no hard link to the payment.
 *
 * Edit mode (`reminder` provided): fields seed from the existing reminder.
 *
 * A non-blocking warning appears when the chosen moment is already in the past.
 */
interface FormShape {
  text: string;
  dueDate: string;
  dueMinutes: number;
}

const DEFAULT_MINUTES = 540; // 09:00

const resolver: Resolver<FormShape, unknown, ReminderFormParsed> = async (values) => {
  const result = ReminderFormSchema.safeParse(values);
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

export interface ReminderPrefill {
  text?: string;
  dueDate?: string;
  dueMinutes?: number;
}

export interface ReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the dialog is in edit mode for this reminder. */
  reminder?: Reminder | null;
  /** Create-mode field prefill (e.g. Payments quick-create). Ignored in edit. */
  prefill?: ReminderPrefill;
}

/** True when `dueDate` + `dueMinutes` is strictly before now (local terms). */
function isPast(dueDate: string, dueMinutes: number, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return false;
  const nowDate = formatLocalDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (dueDate < nowDate) return true;
  if (dueDate > nowDate) return false;
  return dueMinutes < nowMinutes;
}

export function ReminderDialog({ open, onOpenChange, reminder, prefill }: ReminderDialogProps) {
  const { t } = useTranslation();
  const tMsg = useZodMessageTranslator('reminders');

  const createReminder = useCreateReminderMutation();
  const updateReminder = useUpdateReminderMutation();

  const isEdit = !!reminder;

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormShape, unknown, ReminderFormParsed>({
    resolver,
    mode: 'onSubmit',
    defaultValues: { text: '', dueDate: formatLocalDate(new Date()), dueMinutes: DEFAULT_MINUTES },
  });

  // Re-seed the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (reminder) {
      reset({ text: reminder.text, dueDate: reminder.dueDate, dueMinutes: reminder.dueMinutes });
    } else {
      reset({
        text: prefill?.text ?? '',
        dueDate: prefill?.dueDate ?? formatLocalDate(new Date()),
        dueMinutes: prefill?.dueMinutes ?? DEFAULT_MINUTES,
      });
    }
  }, [open, reminder, prefill, reset]);

  const watchedDate = watch('dueDate');
  const watchedMinutes = watch('dueMinutes');
  const showPastWarning =
    !isEdit && isPast(watchedDate, watchedMinutes ?? DEFAULT_MINUTES, new Date());

  const onValid: SubmitHandler<ReminderFormParsed> = (parsed) => {
    if (isEdit && reminder) {
      updateReminder
        .mutateAsync({
          id: reminder.id,
          patch: { text: parsed.text, dueDate: parsed.dueDate, dueMinutes: parsed.dueMinutes },
        })
        .then(() => onOpenChange(false))
        .catch((err: unknown) => {
          console.error('[ReminderDialog] updateReminder failed:', err);
          toast.error(t('reminders.saveFailed'));
        });
      return;
    }

    createReminder
      .mutateAsync({ text: parsed.text, dueDate: parsed.dueDate, dueMinutes: parsed.dueMinutes })
      .then(() => onOpenChange(false))
      .catch((err: unknown) => {
        console.error('[ReminderDialog] createReminder failed:', err);
        toast.error(t('reminders.saveFailed'));
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="bottom-sheet" data-testid="reminder-dialog">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('reminders.dialog.editTitle') : t('reminders.dialog.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onValid)} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reminder-text" className="text-sm font-medium">
              {t('reminders.dialog.text')}
            </label>
            <Input
              {...noAutofill('reminder-text')}
              id="reminder-text"
              type="text"
              placeholder={t('reminders.dialog.textPlaceholder')}
              {...register('text')}
            />
            {errors.text?.message && (
              <p className="text-destructive text-xs" role="alert">
                {tMsg(errors.text.message)}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reminder-date" className="text-sm font-medium">
                {t('reminders.dialog.date')}
              </label>
              <Input
                {...noAutofill('reminder-date')}
                id="reminder-date"
                type="date"
                className="w-44"
                {...register('dueDate')}
              />
              {errors.dueDate?.message && (
                <p className="text-destructive text-xs" role="alert">
                  {tMsg(errors.dueDate.message)}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="reminder-time" className="text-sm font-medium">
                {t('reminders.dialog.time')}
              </label>
              <Controller
                control={control}
                name="dueMinutes"
                render={({ field }) => (
                  <TimeInput
                    id="reminder-time"
                    aria-label={t('reminders.dialog.time')}
                    value={field.value ?? DEFAULT_MINUTES}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
          </div>

          {showPastWarning && (
            <p
              className="text-xs text-amber-600 dark:text-amber-400"
              data-testid="reminder-past-warning"
            >
              {t('reminders.dialog.pastWarning')}
            </p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting} data-testid="reminder-confirm">
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
