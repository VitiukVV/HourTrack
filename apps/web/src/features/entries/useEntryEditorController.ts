import { useEffect, useId, useMemo, useState } from 'react';
import { useForm, type FieldErrors, type Resolver, type SubmitHandler } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Card, Entry } from '@hourtrack/shared-types';
import { earningsForEntry, monthlyEarningsPerEntry } from '@hourtrack/shared-utils';

import { EntryEditorSchema, type EntryEditorParsed } from './entrySchema';
import { useDeleteEntryMutation, useUpdateEntryMutation } from './useEntries';

/**
 * Spec 008 — the state and behaviour behind `EntryEditor`: the form, dirty
 * reporting, the end-time ↔ duration math, the live earnings preview and the
 * save/delete handlers. The component keeps only the markup.
 */

interface FormShape {
  /**
   * S25 (UR-25-4): the entry's calendar day, editable in the modal as the
   * keyboard-/precision-accessible twin of drag-to-reschedule. Seeded from
   * `entry.date`; on save it joins the update patch and the existing surgical
   * range-cache patch + Calendar PATCH move the entry — no mutation changes.
   */
  date: string;
  hours: number;
  minutes: number;
  /**
   * S16: carried in form state so the zod resolver can pass it to
   * `EntryEditorSchema` (which now requires it). The visible HH:MM picker
   * is NOT mounted in S16 — S16b adds it. The field is initialised from
   * `entry.startMinutes` and preserved across save, so existing pre-S16b
   * tests continue to round-trip the entry untouched.
   */
  startMinutes: number;
  useCustomPayment: boolean;
  customPayment: number | null;
  note: string;
}

function entryToForm(entry: Entry): FormShape {
  return {
    date: entry.date,
    hours: Math.floor(entry.durationMin / 60),
    minutes: entry.durationMin % 60,
    startMinutes: entry.startMinutes,
    useCustomPayment: entry.useCustomPayment,
    customPayment: entry.customPayment,
    note: entry.note ?? '',
  };
}

/**
 * Custom resolver that mirrors the CardForm one (`useCardFormController`) — fold form-internal values into
 * the parsed shape and translate zod issues into RHF field errors.
 */
const entryFormResolver: Resolver<FormShape, unknown, EntryEditorParsed> = async (values) => {
  const hours = Number.isFinite(values.hours) ? values.hours : 0;
  const minutes = Number.isFinite(values.minutes) ? values.minutes : 0;
  const candidate = {
    date: values.date,
    hours,
    minutes,
    startMinutes: values.startMinutes,
    useCustomPayment: values.useCustomPayment,
    customPayment: values.useCustomPayment ? values.customPayment : null,
    note: values.note === '' ? null : values.note,
  };

  const result = EntryEditorSchema.safeParse(candidate);
  if (result.success) {
    return { values: result.data, errors: {} };
  }

  const errors: FieldErrors<FormShape> = {};
  for (const issue of result.error.issues) {
    const path = String(issue.path[0] ?? '');
    const target = (path === 'durationMin' ? 'hours' : path) as keyof FormShape;
    if (target && !errors[target]) {
      (errors as Record<string, { type: string; message: string }>)[target] = {
        type: 'zod',
        message: issue.message,
      };
    }
  }
  return { values: {} as never, errors };
};

interface EntryEditorControllerArgs {
  entry: Entry;
  card: Card | undefined;
  allCardEntries: Entry[];
  onSaved?: () => void;
  onDeleted?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function useEntryEditorController({
  entry,
  card,
  allCardEntries,
  onSaved,
  onDeleted,
  onDirtyChange,
}: EntryEditorControllerArgs) {
  const { t } = useTranslation();
  const reactId = useId();
  const fieldId = (suffix: string) => `entry-editor-${reactId}-${suffix}`;

  const updateEntry = useUpdateEntryMutation();
  const deleteEntry = useDeleteEntryMutation();

  const [confirmOpen, setConfirmOpen] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormShape, unknown, EntryEditorParsed>({
    defaultValues: entryToForm(entry),
    resolver: entryFormResolver,
    mode: 'onSubmit',
  });

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const watchedStart = watch('startMinutes');
  const watchedHours = watch('hours');
  const watchedMinutes = watch('minutes');
  const watchedUseCustom = watch('useCustomPayment');
  const watchedCustom = watch('customPayment');

  // Derive end time from start + duration so the EndTime picker stays in sync
  // with hours/minutes. Picking a new end time inverts the math to update
  // hours/minutes; the schema invariant (start + duration <= 1440) still
  // surfaces on submit if the user picks an end < start.
  const watchedDurationMin =
    (Number.isFinite(watchedHours) ? Math.max(0, watchedHours) : 0) * 60 +
    (Number.isFinite(watchedMinutes) ? Math.max(0, watchedMinutes) : 0);
  const derivedEndMinutes = Math.min(1439, watchedStart + watchedDurationMin);
  const handleEndChange = (nextEnd: number) => {
    const newDuration = Math.max(0, nextEnd - watchedStart);
    setValue('hours', Math.floor(newDuration / 60), { shouldDirty: true });
    setValue('minutes', newDuration % 60, { shouldDirty: true });
  };

  /**
   * Live earnings preview. Uses the current form values to project what the
   * earnings will be once saved. Substitutes the current entry's projected
   * durationMin/useCustomPayment/customPayment into `allCardEntries` so the
   * downstream helpers see the unsaved change (matters for the monthly
   * per-entry denominator when toggling custom-payment on/off).
   *
   * Routing mirrors `ReportsTable` byEntry: monthly-rate cards without a
   * custom-payment override go through `monthlyEarningsPerEntry` (so the row
   * shows the entry's share `monthlyTotal / count(non-custom entries in this
   * card's calendar month)`); everything else (hourly, fixed-per-entry,
   * custom-payment override) goes through `earningsForEntry`.
   *
   * S23 Task 25 — pre-filter `othersByCard` (every entry except this one)
   * OUTSIDE the keystroke-hot `useMemo`. The hot path now spreads the
   * pre-filtered list and appends the projected entry — O(N) once when
   * `allCardEntries` changes, then O(1) appends per keystroke. The old
   * shape ran `.map(... ? projected : e)` per keystroke on a card with
   * 200+ entries, allocating 200+ entries on every duration/customPayment
   * input event.
   */
  const othersByCard = useMemo(
    () => allCardEntries.filter((e) => e.id !== entry.id),
    [allCardEntries, entry.id],
  );

  const previewEarnings = useMemo(() => {
    if (!card) return 0;
    const previewDurationMin =
      (Number.isFinite(watchedHours) ? Math.max(0, Math.min(23, watchedHours)) : 0) * 60 +
      (Number.isFinite(watchedMinutes) ? Math.max(0, Math.min(59, watchedMinutes)) : 0);
    const projected: Entry = {
      ...entry,
      durationMin: previewDurationMin,
      useCustomPayment: watchedUseCustom,
      customPayment: watchedUseCustom ? (watchedCustom ?? 0) : null,
    };
    const replaced = [...othersByCard, projected];
    if (card.rateType === 'monthly' && !projected.useCustomPayment) {
      return monthlyEarningsPerEntry(projected, card, replaced);
    }
    return earningsForEntry(projected, card, replaced);
  }, [card, entry, othersByCard, watchedHours, watchedMinutes, watchedUseCustom, watchedCustom]);

  const onValid: SubmitHandler<EntryEditorParsed> = (parsed) => {
    updateEntry
      .mutateAsync({
        id: entry.id,
        patch: {
          // S25: thread through the entry's (possibly edited) calendar day.
          // When unchanged it round-trips identically; when changed, the
          // existing surgical range-cache patch (S23) moves the chip between
          // day buckets and the Calendar PATCH reflects the new date.
          date: parsed.date,
          // S16: thread through the entry's (possibly edited) start-of-day.
          startMinutes: parsed.startMinutes,
          durationMin: parsed.durationMin,
          useCustomPayment: parsed.useCustomPayment,
          customPayment: parsed.customPayment,
          note: parsed.note,
        },
      })
      .then(() => {
        // S06 followup: reset the form to the parsed values so `isDirty`
        // returns to false and the Save button re-disables until the next
        // change. Without this, the button stays enabled even after a
        // successful save, which misleads the user.
        reset({
          date: parsed.date,
          hours: Math.floor(parsed.durationMin / 60),
          minutes: parsed.durationMin % 60,
          startMinutes: parsed.startMinutes,
          useCustomPayment: parsed.useCustomPayment,
          customPayment: parsed.customPayment,
          note: parsed.note ?? '',
        });
        // S17: notify modal callers that the save round-tripped so they can
        // close the dialog. Page-mode (DayPage) leaves `onSaved` unset and
        // gets the legacy stay-mounted behaviour.
        onSaved?.();
      })
      .catch((err: unknown) => {
        // S08 wires the global sonner toaster; surface a user-visible error
        // in addition to logging for traceability.
        console.error('[EntryEditor] updateEntry failed:', err);
        toast.error(t('entries.saveFailed'));
      });
  };

  const handleConfirmDelete = () => {
    setConfirmOpen(false);
    deleteEntry
      .mutateAsync(entry.id)
      .then(() => {
        // S17: notify modal callers (or any future caller that wants to
        // dismiss UI on a successful delete). Page-mode (DayPage) leaves
        // `onDeleted` unset — the deleted row simply disappears from the
        // list via the entries-by-date cache invalidation.
        onDeleted?.();
      })
      .catch((err: unknown) => {
        console.error('[EntryEditor] deleteEntry failed:', err);
        toast.error(t('entries.deleteFailed'));
      });
  };

  return {
    fieldId,
    isSaving: updateEntry.isPending,
    confirmOpen,
    setConfirmOpen,
    control,
    register,
    handleSubmit,
    errors,
    isDirty,
    watchedUseCustom,
    derivedEndMinutes,
    handleEndChange,
    previewEarnings,
    onValid,
    handleConfirmDelete,
  };
}
