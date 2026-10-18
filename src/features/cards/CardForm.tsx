import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useZodMessageTranslator } from '@/lib/i18n/zodI18n';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TimeInput } from '@/components/ui/TimeInput';
import { noAutofill } from '@/lib/utils/noAutofill';

import type { CardInputParsed } from './cardSchema';
import { ColorPicker } from './ColorPicker';
import {
  useCardFormController,
  type CardFormDefaultValues,
  type FormShape,
} from './useCardFormController';

export type { CardFormDefaultValues };

export interface CardFormProps {
  mode: 'create' | 'edit';
  defaultValues?: CardFormDefaultValues;
  onSave: (payload: CardInputParsed) => void;
  onCancel: () => void;
  /** Disable submit while the parent mutation is in flight. */
  isSubmitting?: boolean;
}

// S20 (Task 20) — Rate-type Select option list. Driven by data so S21 can
// append the `monthly` row by editing one line. The labelKey is consumed
// by `t(...)` at render time so locale-switching updates the SelectItem
// labels without a remount.
// S21: appended the third 'monthly' entry per the S20→S21 followup. The
// Select primitive infrastructure is unchanged.
const RATE_TYPE_OPTIONS: Array<{ value: FormShape['rateType']; labelKey: string }> = [
  { value: 'hourly', labelKey: 'cards.hourly' },
  { value: 'fixed', labelKey: 'cards.fixed' },
  { value: 'monthly', labelKey: 'cards.monthly' },
];

/**
 * react-hook-form-driven Card create/edit form with a zod-backed custom
 * resolver. Conditional rate field switches between Hourly rate and
 * Fixed total based on the selected `rateType`. Submit calls `onSave` with
 * the parsed (schema-validated) payload — the caller is responsible for
 * passing it to `useCreateCardMutation` or `useUpdateCardMutation`.
 */
export function CardForm({
  mode,
  defaultValues,
  onSave,
  onCancel,
  isSubmitting = false,
}: CardFormProps) {
  const { t } = useTranslation();
  const {
    fieldId,
    control,
    register,
    handleSubmit,
    setValue,
    errors,
    rateType,
    derivedEndMinutes,
    handleEndChange,
    onValid,
  } = useCardFormController({ mode, defaultValues, onSave });

  const tMsg = useZodMessageTranslator('cards');

  // S19 Task 2: select existing value on focus. Tapping into a filled
  // numeric input highlights the current value so the user's first
  // keypress replaces it. Crucially uses `e.target.select()` and NOT
  // `e.target.value = ''` — the latter bypasses React's controlled-input
  // state and desyncs RHF.
  const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4" noValidate>
      {/* Name */}
      <div className="space-y-1.5">
        <label htmlFor={fieldId('name')} className="text-sm font-medium">
          {t('cards.name')}
        </label>
        <Input
          {...noAutofill('card-name')}
          type="text"
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

      {/* S16b: default start time — minutes since local midnight via TimeInput.
          `flex flex-col items-start gap-2` forces the label + TimeInput to
          stack — the input is `inline-flex` so a plain `space-y-2` would be
          no-op (margin-top on inline elements is ignored). */}
      <div className="flex flex-col items-start gap-2">
        <label htmlFor={fieldId('defaultStartMinutes')} className="text-sm font-medium">
          {t('cards.defaultStartTime')}
        </label>
        <Controller
          name="defaultStartMinutes"
          control={control}
          render={({ field }) => (
            <TimeInput
              id={fieldId('defaultStartMinutes')}
              value={field.value}
              onChange={(mins) => field.onChange(mins)}
              aria-label={t('cards.defaultStartTime')}
            />
          )}
        />
        {errors.defaultStartMinutes?.message && (
          <p className="text-destructive text-xs" role="alert">
            {tMsg(errors.defaultStartMinutes.message)}
          </p>
        )}
      </div>

      {/* Default duration. Editing hours/minutes recomputes the End time
          picker; editing the End time picker recomputes hours/minutes.
          `autoComplete="off"` + the password-manager opt-out attributes
          suppress the iOS QuickType / browser suggestion strip above the
          numpad (cards/addresses/passwords) — these numeric fields don't
          deserve a card suggestion. */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t('cards.defaultDuration')}</span>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <label htmlFor={fieldId('hours')} className="text-muted-foreground text-xs">
              {t('cards.hours')}
            </label>
            {/* S19 Task 1: `pattern="[0-9]*"` + `enterKeyHint="done"` to keep
                iOS Safari from showing the email/password suggestion strip
                above the numpad. Combined with `type="number" inputMode="numeric"`
                this produces a pure 0-9 keypad. */}
            <Input
              {...noAutofill('card-hours')}
              id={fieldId('hours')}
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              min={0}
              max={24}
              className="w-20"
              onFocus={selectOnFocus}
              {...register('hours', { valueAsNumber: true })}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor={fieldId('minutes')} className="text-muted-foreground text-xs">
              {t('cards.minutes')}
            </label>
            <Input
              {...noAutofill('card-minutes')}
              id={fieldId('minutes')}
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              min={0}
              max={59}
              className="w-20"
              onFocus={selectOnFocus}
              {...register('minutes', { valueAsNumber: true })}
            />
          </div>
          <div className="flex flex-col items-start gap-2">
            <label htmlFor={fieldId('endMinutes')} className="text-muted-foreground text-xs">
              {t('cards.endTime')}
            </label>
            <TimeInput
              id={fieldId('endMinutes')}
              value={derivedEndMinutes}
              onChange={handleEndChange}
              aria-label={t('cards.endTime')}
            />
          </div>
        </div>
        {errors.hours?.message && (
          <p className="text-destructive text-xs" role="alert">
            {tMsg(errors.hours.message)}
          </p>
        )}
      </div>

      {/* Rate type — S20 (Task 20): refactored from bespoke radio chips to
          the shared Radix `Select` primitive. Driven by an i18n-keyed
          options array so S21 can extend with `monthly` by appending one
          row, without touching JSX. The Controller wiring is unchanged. */}
      <div className="space-y-1.5">
        <label htmlFor={fieldId('rateType')} className="text-sm font-medium">
          {t('cards.rateType')}
        </label>
        <Controller
          name="rateType"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(next) => {
                field.onChange(next);
                // Mirror the prior radio handler's intent: switching off a
                // rate-type clears the now-inactive numeric fields so the
                // user doesn't accidentally submit a stale value.
                // S21: with three rate types, switching always clears the
                // two non-active fields (the active one is preserved so a
                // user who typed a value, briefly switched away, and
                // switched back doesn't lose their input).
                if (next === 'hourly') {
                  setValue('fixedTotal', null);
                  setValue('monthlyTotal', null);
                }
                if (next === 'fixed') {
                  setValue('hourlyRate', null);
                  setValue('monthlyTotal', null);
                }
                if (next === 'monthly') {
                  setValue('hourlyRate', null);
                  setValue('fixedTotal', null);
                }
              }}
            >
              <SelectTrigger
                id={fieldId('rateType')}
                aria-label={t('cards.rateType')}
                data-testid="cardform-rate-type-trigger"
                className="w-40"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RATE_TYPE_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    data-testid={`cardform-rate-type-option-${opt.value}`}
                  >
                    {t(opt.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {/* Conditional rate field — exactly one of the three numeric inputs is
          mounted at a time, driven by the rateType Select above. */}
      {rateType === 'hourly' && (
        <div className="space-y-1.5">
          <label htmlFor={fieldId('hourlyRate')} className="text-sm font-medium">
            {t('cards.hourlyRate')}
          </label>
          <Input
            {...noAutofill('card-hourly-rate')}
            id={fieldId('hourlyRate')}
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            className="w-32"
            onFocus={selectOnFocus}
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
      )}
      {rateType === 'fixed' && (
        <div className="space-y-1.5">
          <label htmlFor={fieldId('fixedTotal')} className="text-sm font-medium">
            {t('cards.fixedTotal')}
          </label>
          <Input
            {...noAutofill('card-fixed-total')}
            id={fieldId('fixedTotal')}
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            className="w-32"
            onFocus={selectOnFocus}
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
      {/* S21 — monthly retainer input. Identical UX to hourlyRate/fixedTotal
          (decimal, step 0.01, min 0). The schema enforces "required +
          positive" via the cardSchema.ts monthly discriminator branch. */}
      {rateType === 'monthly' && (
        <div className="space-y-1.5">
          <label htmlFor={fieldId('monthlyTotal')} className="text-sm font-medium">
            {t('cards.monthlyTotal')}
          </label>
          <Input
            {...noAutofill('card-monthly-total')}
            id={fieldId('monthlyTotal')}
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            className="w-32"
            onFocus={selectOnFocus}
            {...register('monthlyTotal', {
              setValueAs: (v: unknown) => {
                if (v === '' || v === null || v === undefined) return null;
                const n = typeof v === 'number' ? v : Number(v);
                return Number.isNaN(n) ? null : n;
              },
            })}
          />
          {errors.monthlyTotal?.message && (
            <p className="text-destructive text-xs" role="alert">
              {tMsg(errors.monthlyTotal.message)}
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
          className="border-input focus-visible:ring-ring placeholder:text-muted-foreground flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
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
