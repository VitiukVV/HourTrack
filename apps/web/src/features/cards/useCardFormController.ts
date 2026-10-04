import { useId, useMemo } from 'react';
import { useForm, type FieldErrors, type Resolver, type SubmitHandler } from 'react-hook-form';

import { CardInputSchema, type CardInputParsed } from './cardSchema';

/**
 * Spec 008 — the state and behaviour behind `CardForm`: the form and its
 * zod-backed resolver, create/edit defaults and the end-time ↔ duration
 * math. The component keeps only the markup.
 */

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

/**
 * Form-internal shape. The wire/DB shape stores `defaultDurationMin` as a
 * single integer; the form surface exposes Hours + Minutes as two integer
 * fields per UR #21. The custom resolver below collapses them before zod
 * validation runs.
 */
export interface FormShape {
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

interface CardFormControllerArgs {
  mode: 'create' | 'edit';
  defaultValues?: CardFormDefaultValues;
  onSave: (payload: CardInputParsed) => void;
}

export function useCardFormController({ mode, defaultValues, onSave }: CardFormControllerArgs) {
  const reactId = useId();
  const fieldId = (suffix: string) => `cardform-${reactId}-${suffix}`;

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
    },
    [],
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

  return {
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
  };
}
