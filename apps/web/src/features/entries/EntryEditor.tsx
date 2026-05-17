import { useId, useMemo, useState } from 'react';
import {
  Controller,
  useForm,
  type FieldErrors,
  type Resolver,
  type SubmitHandler,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Card, Entry } from '@hourtrack/shared-types';
import { earningsForEntry } from '@hourtrack/shared-utils';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TimeInput } from '@/components/ui/TimeInput';
import { getReadableTextColor } from '@/lib/colors';
import { formatDate } from '@/lib/date';
import { getSyncManager } from '@/features/sync/SyncManager';

import { EntryEditorSchema, type EntryEditorParsed } from './entrySchema';
import { useDeleteEntryMutation, useUpdateEntryMutation } from './useEntries';

/**
 * Inline-editable row for a single Entry on the DayPage (S06).
 *
 * Fields:
 *   - Header chip: card color dot + card name (read-only here — changing the
 *     card belongs to a future "reassign entry" flow, deferred per sprint
 *     spec).
 *   - Hours + Minutes: two integer inputs. Collapsed into `durationMin` via
 *     `parseDuration` by the zod resolver on save.
 *   - Custom payment: Switch + amount input (visible only when toggle is ON).
 *   - Note: textarea, optional, capped at 500 chars.
 *   - Earnings: read-only, displays `earningsForEntry(...).toFixed(2)` EUR.
 *     Recomputes live from the current form values so the user sees the
 *     effect of changes before saving.
 *
 * Save button is disabled when no fields are dirty. Validation errors render
 * inline (i18n'd via `tMsg`). Delete opens `ConfirmDialog` and runs the
 * delete mutation on confirm.
 *
 * Mirrors the `CardForm` pattern from S03: a custom resolver collapses the
 * UI-shape (hours/minutes) into the DB-shape (durationMin) inside zod.
 */

interface FormShape {
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

export interface EntryEditorProps {
  entry: Entry;
  card: Card | undefined;
  /**
   * All entries belonging to `card` in scope — needed for `earningsForEntry`
   * fixed-rate proportional split. Caller (DayPage) supplies the per-card
   * entry list it already has from `getEntriesByCardId`.
   */
  allCardEntries: Entry[];
  /**
   * S17 — fires after a successful `updateEntry` mutation. Used by
   * `EntryEditModal` to close the dialog once the save round-trips. The page-
   * mode call site (`DayPage`) leaves this unset → form just resets and stays
   * mounted as before.
   */
  onSaved?: () => void;
  /**
   * S17 — when provided, the editor renders a Cancel button next to Save
   * (labelled by `entries.editor.cancel`). The modal supplies it so the user
   * has an explicit "abandon edit" affordance + it doubles as the click
   * target for the modal's dirty-check / discard flow.
   */
  onCancelClick?: () => void;
  /**
   * S17 — when true, the destructive Delete button is hidden. The modal
   * surfaces its own Delete button in the dialog footer; the inline-page
   * mode keeps the existing button. Default `false` preserves the DayPage
   * behaviour byte-for-byte.
   */
  hideDelete?: boolean;
  /**
   * S17 — fires after a successful `deleteEntry` mutation. The modal uses
   * it to close the dialog once the entry is gone (the chip on the
   * calendar surface will also disappear via the entries-in-range
   * invalidation, but the modal's own close needs an explicit signal).
   */
  onDeleted?: () => void;
}

const FALLBACK_COLOR = '#94A3B8';

function entryToForm(entry: Entry): FormShape {
  return {
    hours: Math.floor(entry.durationMin / 60),
    minutes: entry.durationMin % 60,
    startMinutes: entry.startMinutes,
    useCustomPayment: entry.useCustomPayment,
    customPayment: entry.customPayment,
    note: entry.note ?? '',
  };
}

/**
 * Custom resolver that mirrors S03 CardForm — fold form-internal values into
 * the parsed shape and translate zod issues into RHF field errors.
 */
const entryFormResolver: Resolver<FormShape, unknown, EntryEditorParsed> = async (values) => {
  const hours = Number.isFinite(values.hours) ? values.hours : 0;
  const minutes = Number.isFinite(values.minutes) ? values.minutes : 0;
  const candidate = {
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

export function EntryEditor({
  entry,
  card,
  allCardEntries,
  onSaved,
  onCancelClick,
  hideDelete = false,
  onDeleted,
}: EntryEditorProps) {
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
    reset,
    formState: { errors, isDirty },
  } = useForm<FormShape, unknown, EntryEditorParsed>({
    defaultValues: entryToForm(entry),
    resolver: entryFormResolver,
    mode: 'onSubmit',
  });

  const watchedHours = watch('hours');
  const watchedMinutes = watch('minutes');
  const watchedUseCustom = watch('useCustomPayment');
  const watchedCustom = watch('customPayment');

  /**
   * Live earnings preview. Uses the current form values to project what the
   * earnings will be once saved. For fixed-rate cards, we substitute the
   * current entry's projected durationMin/useCustomPayment/customPayment into
   * `allCardEntries` so the proportional split reflects the unsaved change.
   */
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
    // Replace the current entry in the card-entries list so fixed-rate split
    // sees the projected values.
    const replaced = allCardEntries.map((e) => (e.id === entry.id ? projected : e));
    return earningsForEntry(projected, card, replaced);
  }, [card, entry, allCardEntries, watchedHours, watchedMinutes, watchedUseCustom, watchedCustom]);

  const onValid: SubmitHandler<EntryEditorParsed> = (parsed) => {
    updateEntry
      .mutateAsync({
        id: entry.id,
        patch: {
          // S16: thread through the entry's (possibly edited) start-of-day.
          // No visible picker this sprint, so the value round-trips
          // unchanged unless a future-S16b code path mutates it.
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

  function tMsg(msg: string | undefined): string | undefined {
    if (!msg) return undefined;
    if (msg.startsWith('entries.')) return t(msg);
    return msg;
  }

  const color = card?.color ?? FALLBACK_COLOR;
  const cardName = card?.name ?? '...';

  return (
    <div
      data-testid="entry-editor"
      data-card-color={color}
      className="border-border bg-background flex flex-col gap-3 rounded-md border p-3"
    >
      {/* Header: card pill + card name */}
      {/* S19 Task 13 — drop the leading color dot, render the card as a */}
      {/* small full-color pill instead. Same treatment as ReportsTable. */}
      <div className="flex items-center gap-2">
        <span
          style={{
            backgroundColor: color,
            color: getReadableTextColor(color),
          }}
          className="inline-flex max-w-[12rem] truncate rounded-full px-2 py-0.5 text-xs font-semibold"
          title={cardName}
        >
          {cardName}
        </span>
      </div>

      <form onSubmit={handleSubmit(onValid)} className="flex flex-col gap-3" noValidate>
        {/* S16b: start-of-day time picker. Sits ABOVE the duration row so the
            user thinks "when does this entry start" before "how long was it".
            `flex flex-col items-start gap-2` forces the label + TimeInput to
            stack — the input is `inline-flex` so a plain `space-y-2` would be
            no-op (margin-top on inline elements is ignored). */}
        <div className="flex flex-col items-start gap-2">
          <label htmlFor={fieldId('startMinutes')} className="text-muted-foreground text-xs">
            {t('entries.startTime')}
          </label>
          <Controller
            name="startMinutes"
            control={control}
            render={({ field }) => (
              <TimeInput
                id={fieldId('startMinutes')}
                value={field.value}
                onChange={(mins) => field.onChange(mins)}
                aria-label={t('entries.startTime')}
              />
            )}
          />
          {errors.startMinutes?.message && (
            <p className="text-destructive text-xs" role="alert">
              {tMsg(errors.startMinutes.message)}
            </p>
          )}
        </div>

        {/* Hours + Minutes */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <label htmlFor={fieldId('hours')} className="text-muted-foreground text-xs">
              {t('entries.editor.hours')}
            </label>
            <Input
              id={fieldId('hours')}
              type="number"
              inputMode="numeric"
              min={0}
              max={23}
              className="w-20"
              {...register('hours', { valueAsNumber: true })}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor={fieldId('minutes')} className="text-muted-foreground text-xs">
              {t('entries.editor.minutes')}
            </label>
            <Input
              id={fieldId('minutes')}
              type="number"
              inputMode="numeric"
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
        {errors.minutes?.message && (
          <p className="text-destructive text-xs" role="alert">
            {tMsg(errors.minutes.message)}
          </p>
        )}

        {/* Custom payment toggle + amount */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Controller
              name="useCustomPayment"
              control={control}
              render={({ field }) => (
                <Switch
                  id={fieldId('useCustomPayment')}
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(v)}
                  aria-label={t('entries.editor.useCustomPayment')}
                />
              )}
            />
            <label htmlFor={fieldId('useCustomPayment')} className="text-sm font-medium">
              {t('entries.editor.useCustomPayment')}
            </label>
          </div>
          {watchedUseCustom && (
            <>
              <div className="space-y-1">
                <label
                  htmlFor={fieldId('customPaymentAmount')}
                  className="text-muted-foreground text-xs"
                >
                  {t('entries.editor.customPaymentAmount')}
                </label>
                <Input
                  id={fieldId('customPaymentAmount')}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  className="w-32"
                  {...register('customPayment', {
                    setValueAs: (v: unknown) => {
                      if (v === '' || v === null || v === undefined) return null;
                      const n = typeof v === 'number' ? v : Number(v);
                      return Number.isNaN(n) ? null : n;
                    },
                  })}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                {t('entries.editor.customPaymentHint')}
              </p>
            </>
          )}
          {errors.customPayment?.message && (
            <p className="text-destructive text-xs" role="alert">
              {tMsg(errors.customPayment.message)}
            </p>
          )}
        </div>

        {/* Note */}
        <div className="space-y-1.5">
          <label htmlFor={fieldId('note')} className="text-sm font-medium">
            {t('entries.editor.note')}
          </label>
          <textarea
            id={fieldId('note')}
            rows={2}
            placeholder={t('entries.editor.notePlaceholder')}
            className="border-input focus-visible:ring-ring placeholder:text-muted-foreground flex w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
            {...register('note')}
          />
          {errors.note?.message && (
            <p className="text-destructive text-xs" role="alert">
              {tMsg(errors.note.message)}
            </p>
          )}
        </div>

        {/* Calendar sync error surface. Hidden in the happy path; renders an
            inline warning + Retry button when the last calendar op for this
            entry failed (S12). The retry simply re-enqueues the update op —
            handler falls through to a create when googleEventId is missing. */}
        {entry.syncStatus === 'error' && (
          <div
            className="border-destructive/40 bg-destructive/10 text-destructive flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
            data-testid="entry-editor-sync-error"
            role="alert"
          >
            <span className="truncate">
              <span aria-hidden="true">⚠ </span>
              {t('googleCalendar.syncError')}
              {entry.syncError ? `: ${entry.syncError}` : ''}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void getSyncManager()
                  .enqueue({
                    op: 'updateCalendarEvent',
                    entityType: 'entry',
                    entityId: entry.id,
                  })
                  .catch((err: unknown) => {
                    console.warn('[EntryEditor] retry enqueue failed', err);
                  });
                toast.success(t('sync.online'));
              }}
              data-testid="entry-editor-sync-retry"
            >
              {t('googleCalendar.retrySync')}
            </Button>
          </div>
        )}

        {/* Earnings preview + actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm">
            <span className="text-muted-foreground">{t('entries.editor.earnings')}: </span>
            <span data-testid="entry-editor-earnings" className="font-medium">
              {previewEarnings.toFixed(2)} EUR
            </span>
          </div>
          <div className="flex gap-2">
            {!hideDelete && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfirmOpen(true)}
              >
                {t('entries.editor.delete')}
              </Button>
            )}
            {/* S17: modal-supplied Cancel button. Sits next to Save so a user
                tabbing through the form lands on Save first, Cancel second,
                matching the destructive/primary-action right-aligned convention. */}
            {onCancelClick && (
              <Button type="button" variant="outline" size="sm" onClick={onCancelClick}>
                {t('entries.editor.cancel')}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={!isDirty || updateEntry.isPending}>
              {t('entries.editor.save')}
            </Button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('entries.confirmDelete.title')}
        body={t('entries.confirmDelete.body', {
          card: cardName,
          date: formatDate(entry.date),
        })}
        confirmLabel={t('entries.editor.delete')}
        cancelLabel={t('entries.editor.cancel')}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
