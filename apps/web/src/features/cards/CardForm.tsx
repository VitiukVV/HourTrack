import { useId } from 'react';
import {
  useForm,
  Controller,
  type FieldErrors,
  type Resolver,
  type SubmitHandler,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { CardInputSchema, type CardInputParsed } from './cardSchema';
import { ColorPicker } from './ColorPicker';

/**
 * Form-internal shape. The wire/DB shape stores `defaultDurationMin` as a
 * single integer; the form surface exposes Hours + Minutes as two integer
 * fields per UR #21. The custom resolver below collapses them before zod
 * validation runs.
 */
interface FormShape {
  name: string;
  color: string;
  hours: number;
  minutes: number;
  rateType: 'hourly' | 'fixed';
  hourlyRate: number | null;
  fixedTotal: number | null;
  defaultNote: string;
}

export interface CardFormDefaultValues {
  name: string;
  color: string;
  defaultDurationMin: number;
  rateType: 'hourly' | 'fixed';
  hourlyRate: number | null;
  fixedTotal: number | null;
  defaultNote: string | null;
}

export interface CardFormProps {
  mode: 'create' | 'edit';
  defaultValues?: CardFormDefaultValues;
  onSave: (payload: CardInputParsed) => void;
  onCancel: () => void;
  /** Disable submit while the parent mutation is in flight. */
  isSubmitting?: boolean;
}

const FALLBACK_COLOR = '#3B82F6';
const FALLBACK_DURATION_MIN = 480; // 8h

function defaultsToForm(d?: CardFormDefaultValues): FormShape {
  const totalMin = d?.defaultDurationMin ?? FALLBACK_DURATION_MIN;
  return {
    name: d?.name ?? '',
    color: d?.color ?? FALLBACK_COLOR,
    hours: Math.floor(totalMin / 60),
    minutes: totalMin % 60,
    rateType: d?.rateType ?? 'hourly',
    // S03 followup: do NOT seed an opinion (`20` / `1000`) for rate fields when
    // creating a fresh card. Empty inputs give the user a clear "you must
    // type" cue; the previous defaults silently survived form validation
    // and landed in the DB unchanged. Edit mode still pre-fills from the
    // existing card.
    hourlyRate: d?.hourlyRate ?? null,
    fixedTotal: d?.fixedTotal ?? null,
    defaultNote: d?.defaultNote ?? '',
  };
}

/**
 * Custom resolver: collapses `hours/minutes` into `defaultDurationMin`,
 * normalises the conditional rate fields based on `rateType`, then runs the
 * shared `CardInputSchema` (the same schema that the DB layer's
 * `assertCardShape` ultimately mirrors). zod issues are surfaced as
 * react-hook-form field errors with i18n keys as messages, which the form
 * translates at render time.
 *
 * Resolver is typed against the parsed output (`CardInputParsed`) so
 * `handleSubmit`'s `data` argument is already the validated shape — callers
 * never see the raw `FormShape` after submit succeeds.
 */
const cardFormResolver: Resolver<FormShape, unknown, CardInputParsed> = async (values) => {
  const hours = Number.isFinite(values.hours) ? values.hours : 0;
  const minutes = Number.isFinite(values.minutes) ? values.minutes : 0;
  const candidate = {
    name: values.name,
    color: values.color,
    defaultDurationMin: hours * 60 + minutes,
    rateType: values.rateType,
    hourlyRate: values.rateType === 'hourly' ? values.hourlyRate : null,
    fixedTotal: values.rateType === 'fixed' ? values.fixedTotal : null,
    defaultNote: values.defaultNote === '' ? null : values.defaultNote,
  };

  const result = CardInputSchema.safeParse(candidate);
  if (result.success) {
    return { values: result.data, errors: {} };
  }

  const errors: FieldErrors<FormShape> = {};
  for (const issue of result.error.issues) {
    const path = String(issue.path[0] ?? '');
    // Map server-side `defaultDurationMin` errors onto the visible `hours` field.
    const target = (path === 'defaultDurationMin' ? 'hours' : path) as keyof FormShape;
    if (target && !errors[target]) {
      (errors as Record<string, { type: string; message: string }>)[target] = {
        type: 'zod',
        message: issue.message,
      };
    }
  }
  return { values: {} as never, errors };
};

/**
 * react-hook-form-driven Card create/edit form with a zod-backed custom
 * resolver. Conditional rate field switches between Hourly rate and
 * Fixed total based on the selected `rateType`. Submit calls `onSave` with
 * the parsed (schema-validated) payload — the caller is responsible for
 * passing it to `useCreateCardMutation` or `useUpdateCardMutation`.
 */
export function CardForm({
  mode: _mode,
  defaultValues,
  onSave,
  onCancel,
  isSubmitting = false,
}: CardFormProps) {
  const { t } = useTranslation();
  const reactId = useId();
  const fieldId = (suffix: string) => `cardform-${reactId}-${suffix}`;

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormShape, unknown, CardInputParsed>({
    defaultValues: defaultsToForm(defaultValues),
    resolver: cardFormResolver,
    mode: 'onSubmit',
  });

  const rateType = watch('rateType');

  const onValid: SubmitHandler<CardInputParsed> = (parsed) => {
    onSave(parsed);
  };

  /**
   * Translate i18n-key messages emitted by zod; fall back to the raw message
   * if it doesn't start with `cards.` (defence against typos during dev).
   */
  function tMsg(msg: string | undefined): string | undefined {
    if (!msg) return undefined;
    if (msg.startsWith('cards.')) return t(msg);
    return msg;
  }

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4" noValidate>
      {/* Name */}
      <div className="space-y-1.5">
        <label htmlFor={fieldId('name')} className="text-sm font-medium">
          {t('cards.name')}
        </label>
        <Input
          id={fieldId('name')}
          placeholder={t('cards.namePlaceholder')}
          {...register('name')}
        />
        {errors.name?.message && (
          <p className="text-destructive text-xs" role="alert">
            {tMsg(errors.name.message)}
          </p>
        )}
      </div>

      {/* Color */}
      <div className="space-y-1.5">
        <span id={fieldId('color-label')} className="text-sm font-medium">
          {t('cards.color')}
        </span>
        <Controller
          name="color"
          control={control}
          render={({ field }) => (
            <ColorPicker
              id={fieldId('color')}
              value={field.value}
              onChange={(hex) => field.onChange(hex)}
            />
          )}
        />
        {errors.color?.message && (
          <p className="text-destructive text-xs" role="alert">
            {tMsg(errors.color.message)}
          </p>
        )}
      </div>

      {/* Default duration */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t('cards.defaultDuration')}</span>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <label htmlFor={fieldId('hours')} className="text-muted-foreground text-xs">
              {t('cards.hours')}
            </label>
            <Input
              id={fieldId('hours')}
              type="number"
              min={0}
              max={24}
              className="w-20"
              {...register('hours', { valueAsNumber: true })}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={fieldId('minutes')} className="text-muted-foreground text-xs">
              {t('cards.minutes')}
            </label>
            <Input
              id={fieldId('minutes')}
              type="number"
              min={0}
              max={59}
              className="w-20"
              {...register('minutes', { valueAsNumber: true })}
            />
          </div>
        </div>
        {errors.hours?.message && (
          <p className="text-destructive text-xs" role="alert">
            {tMsg(errors.hours.message)}
          </p>
        )}
      </div>

      {/* Rate type */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t('cards.rateType')}</span>
        <Controller
          name="rateType"
          control={control}
          render={({ field }) => {
            const hourlyId = fieldId('rate-hourly');
            const fixedId = fieldId('rate-fixed');
            return (
              <div role="radiogroup" aria-label={t('cards.rateType')} className="flex gap-2">
                <label
                  htmlFor={hourlyId}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
                    field.value === 'hourly' && 'border-foreground bg-secondary',
                  )}
                >
                  <input
                    id={hourlyId}
                    type="radio"
                    value="hourly"
                    aria-label={t('cards.hourly')}
                    checked={field.value === 'hourly'}
                    onChange={() => {
                      field.onChange('hourly');
                      // S03 followup: do not auto-seed `hourlyRate`; leave it
                      // null/empty so the user types an explicit value.
                      setValue('fixedTotal', null);
                    }}
                    className="sr-only"
                  />
                  {t('cards.hourly')}
                </label>
                <label
                  htmlFor={fixedId}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
                    field.value === 'fixed' && 'border-foreground bg-secondary',
                  )}
                >
                  <input
                    id={fixedId}
                    type="radio"
                    value="fixed"
                    aria-label={t('cards.fixed')}
                    checked={field.value === 'fixed'}
                    onChange={() => {
                      field.onChange('fixed');
                      // S03 followup: do not auto-seed `fixedTotal`; leave it
                      // null/empty so the user types an explicit value.
                      setValue('hourlyRate', null);
                    }}
                    className="sr-only"
                  />
                  {t('cards.fixed')}
                </label>
              </div>
            );
          }}
        />
      </div>

      {/* Conditional rate field */}
      {rateType === 'hourly' ? (
        <div className="space-y-1.5">
          <label htmlFor={fieldId('hourlyRate')} className="text-sm font-medium">
            {t('cards.hourlyRate')}
          </label>
          <Input
            id={fieldId('hourlyRate')}
            type="number"
            step="0.01"
            min={0}
            className="w-32"
            {...register('hourlyRate', {
              setValueAs: (v: unknown) => {
                if (v === '' || v === null || v === undefined) return null;
                const n = typeof v === 'number' ? v : Number(v);
                return Number.isNaN(n) ? null : n;
              },
            })}
          />
          {errors.hourlyRate?.message && (
            <p className="text-destructive text-xs" role="alert">
              {tMsg(errors.hourlyRate.message)}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor={fieldId('fixedTotal')} className="text-sm font-medium">
            {t('cards.fixedTotal')}
          </label>
          <Input
            id={fieldId('fixedTotal')}
            type="number"
            step="0.01"
            min={0}
            className="w-32"
            {...register('fixedTotal', {
              setValueAs: (v: unknown) => {
                if (v === '' || v === null || v === undefined) return null;
                const n = typeof v === 'number' ? v : Number(v);
                return Number.isNaN(n) ? null : n;
              },
            })}
          />
          {errors.fixedTotal?.message && (
            <p className="text-destructive text-xs" role="alert">
              {tMsg(errors.fixedTotal.message)}
            </p>
          )}
        </div>
      )}

      {/* Default note */}
      <div className="space-y-1.5">
        <label htmlFor={fieldId('defaultNote')} className="text-sm font-medium">
          {t('cards.defaultNote')}
        </label>
        <textarea
          id={fieldId('defaultNote')}
          rows={3}
          placeholder={t('cards.defaultNotePlaceholder')}
          className="border-input focus-visible:ring-ring placeholder:text-muted-foreground flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
          {...register('defaultNote')}
        />
        {errors.defaultNote?.message && (
          <p className="text-destructive text-xs" role="alert">
            {tMsg(errors.defaultNote.message)}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
