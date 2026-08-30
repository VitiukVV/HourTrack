import { useId, useMemo } from 'react';
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
import { useZodMessageTranslator } from '@/lib/zodI18n';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TimeInput } from '@/components/ui/TimeInput';

import { buildCardInputSchema, type CardInputParsed } from './cardSchema';
import { ColorPicker } from './ColorPicker';
import { noAutofill } from '@/lib/noAutofill';

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
  /**
   * S16: carried through the form shape so the zod resolver can pass it to
   * `CardInputSchema` (which now requires it). The visible HH:MM picker is
   * NOT mounted in S16 — that's S16b's job. The field is seeded with
   * `FALLBACK_START_MINUTES` (600 = 10:00) in create mode and pre-filled
   * from `defaultValues.defaultStartMinutes` in edit mode, so existing
   * S15-vintage tests that don't touch a time input still submit a
   * valid payload.
   */
  defaultStartMinutes: number;
  // S21: rateType now spans hourly / fixed / monthly.
  rateType: 'hourly' | 'fixed' | 'monthly';
  hourlyRate: number | null;
  fixedTotal: number | null;
  monthlyTotal: number | null;
  defaultNote: string;
}

export interface CardFormDefaultValues {
  name: string;
  color: string;
  defaultDurationMin: number;
  /** S16: minutes since local midnight. Optional in the props shape so legacy
   *  callers (S03-era unit tests) still type-check; the form falls back to
   *  `FALLBACK_START_MINUTES` (10:00) when omitted. */
  defaultStartMinutes?: number;
  // S21: rateType extension. Monthly cards expect `monthlyTotal` non-null.
  rateType: 'hourly' | 'fixed' | 'monthly';
  hourlyRate: number | null;
  fixedTotal: number | null;
  /** S21: monthly retainer (EUR/month). Optional on the props shape so
   *  legacy callers that don't touch monthly cards still type-check. */
  monthlyTotal?: number | null;
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

// S19 (Part B Task 5): the palette swap changed the default blue. Keep the
// FALLBACK_COLOR pointing at the new-palette blue (`#2563EB`) so a freshly
// created card without a deliberate color pick still parses cleanly.
const FALLBACK_COLOR = '#2563EB';
const FALLBACK_DURATION_MIN = 480; // 8h (used only for the edit-mode fallback path)
// S16b: 540 = 09:00. New-card create mode seeds the TimeInput with 09:00
// (per V2_FEATURE_PLAN decision #5 — a typical workday-start default).
// S16 originally seeded 600 (10:00); S16b changed the new-card default to
// 09:00 once the visible picker landed. Edit mode still preserves the
// existing card's value, so no upgrade fix-up is needed.
const FALLBACK_START_MINUTES = 540;

/**
 * Translate `CardFormDefaultValues` into the internal `FormShape`. The
 * create-vs-edit branch matters for two fields:
 *
 *   - `hours` / `minutes`: in create mode (S19 UR-19-1 Task 3) we now seed
 *     0/0 instead of 8h/0 so users explicitly type the duration. Edit mode
 *     preserves the existing card's split so we don't silently overwrite.
 *   - `defaultNote` falls back to `''` so RHF doesn't see `null` on a
 *     controlled textarea (warning).
 */
function defaultsToForm(mode: 'create' | 'edit', d?: CardFormDefaultValues): FormShape {
  const isCreate = mode === 'create';
  const totalMin = d?.defaultDurationMin ?? (isCreate ? 0 : FALLBACK_DURATION_MIN);
  return {
    name: d?.name ?? '',
    color: d?.color ?? FALLBACK_COLOR,
    hours: Math.floor(totalMin / 60),
    minutes: totalMin % 60,
    defaultStartMinutes: d?.defaultStartMinutes ?? FALLBACK_START_MINUTES,
    rateType: d?.rateType ?? 'hourly',
    // S03 followup: do NOT seed an opinion (`20` / `1000`) for rate fields when
    // creating a fresh card. Empty inputs give the user a clear "you must
    // type" cue; the previous defaults silently survived form validation
    // and landed in the DB unchanged. Edit mode still pre-fills from the
    // existing card.
    hourlyRate: d?.hourlyRate ?? null,
    fixedTotal: d?.fixedTotal ?? null,
    // S21: monthly retainer field. Same "no opinionated default" treatment
    // as the other rate fields — null until the user picks Monthly and
    // types a value. In edit mode the existing card's value pre-fills.
    monthlyTotal: d?.monthlyTotal ?? null,
    defaultNote: d?.defaultNote ?? '',
  };
}

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
  const reactId = useId();
  const fieldId = (suffix: string) => `cardform-${reactId}-${suffix}`;

  // S19 Task 8: in edit mode, allow the existing legacy hex through validation
  // so the user can save other field changes without being forced to pick a
  // new-palette swatch. On the next save with a new-palette color, the card
  // is normalised organically.
  const schema = useMemo(
    () => buildCardInputSchema(mode === 'edit' ? defaultValues?.color : undefined),
    [mode, defaultValues?.color],
  );

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
  const cardFormResolver: Resolver<FormShape, unknown, CardInputParsed> = useMemo(
    () => async (values) => {
      const hours = Number.isFinite(values.hours) ? values.hours : 0;
      const minutes = Number.isFinite(values.minutes) ? values.minutes : 0;
      const candidate = {
        name: values.name,
        color: values.color,
        defaultDurationMin: hours * 60 + minutes,
        defaultStartMinutes: values.defaultStartMinutes,
        rateType: values.rateType,
        // S21: rateType discriminates which numeric field carries the
        // value. The two inactive rate fields are pinned to null so the
        // discriminated union's invariants hold (zod rejects a non-null
        // sibling when rateType doesn't match).
        hourlyRate: values.rateType === 'hourly' ? values.hourlyRate : null,
        fixedTotal: values.rateType === 'fixed' ? values.fixedTotal : null,
        monthlyTotal: values.rateType === 'monthly' ? values.monthlyTotal : null,
        defaultNote: values.defaultNote === '' ? null : values.defaultNote,
      };

      const result = schema.safeParse(candidate);
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
    },
    [schema],
  );

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormShape, unknown, CardInputParsed>({
    defaultValues: defaultsToForm(mode, defaultValues),
    resolver: cardFormResolver,
    mode: 'onSubmit',
  });

  const rateType = watch('rateType');
  const watchedStart = watch('defaultStartMinutes');
  const watchedHours = watch('hours');
  const watchedMinutes = watch('minutes');

  // Derive end time from start + duration so picking an end time on the form
  // back-solves the hours/minutes fields. Mirrors the EntryEditor flow so the
  // card creator can declare either "duration" or "when it ends" and have the
  // other side stay consistent.
  const watchedDurationMin =
    (Number.isFinite(watchedHours) ? Math.max(0, watchedHours) : 0) * 60 +
    (Number.isFinite(watchedMinutes) ? Math.max(0, watchedMinutes) : 0);
  const derivedEndMinutes = Math.min(1439, (watchedStart ?? 0) + watchedDurationMin);
  const handleEndChange = (nextEnd: number) => {
    const newDuration = Math.max(0, nextEnd - (watchedStart ?? 0));
    setValue('hours', Math.floor(newDuration / 60), { shouldDirty: true });
    setValue('minutes', newDuration % 60, { shouldDirty: true });
  };

  const onValid: SubmitHandler<CardInputParsed> = (parsed) => {
    onSave(parsed);
  };

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
