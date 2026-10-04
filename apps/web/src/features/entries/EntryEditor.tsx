import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Card, Entry } from '@hourtrack/shared-types';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useZodMessageTranslator } from '@/lib/i18n/zodI18n';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TimeInput } from '@/components/ui/TimeInput';
import { getReadableTextColor } from '@/lib/ui/colors';
import { formatDate } from '@/lib/utils/date';
import { getSyncManager } from '@/features/sync/SyncManager';
import { noAutofill } from '@/lib/utils/noAutofill';

import { useEntryEditorController } from './useEntryEditorController';

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
 * Mirrors the `CardForm` pattern from S03: a custom resolver (in
 * `useEntryEditorController`) collapses the UI-shape (hours/minutes) into the
 * DB-shape (durationMin) inside zod.
 */

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
  /**
   * Mirrors react-hook-form's `formState.isDirty` upward. `EntryEditModal`
   * uses it to decide whether closing needs a "discard changes?" confirm.
   * It used to infer that from bubbling `input`/`change` events, which miss
   * every button-driven control — toggling the custom-payment Switch and
   * pressing Esc discarded the change with no prompt.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

const FALLBACK_COLOR = '#94A3B8';

export function EntryEditor({
  entry,
  card,
  allCardEntries,
  onSaved,
  onCancelClick,
  hideDelete = false,
  onDeleted,
  onDirtyChange,
}: EntryEditorProps) {
  const { t } = useTranslation();
  const {
    fieldId,
    isSaving,
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
  } = useEntryEditorController({ entry, card, allCardEntries, onSaved, onDeleted, onDirtyChange });

  const tMsg = useZodMessageTranslator('entries');

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
        {/* S25 (UR-25-4): editable calendar date — the keyboard-/precision-
            accessible twin of drag-to-reschedule. A native `<input type="date">`
            is keyboard- and mobile-friendly and needs no new dependency. Sits
            above the start-time row ("which day" before "what time"). It
            registers through RHF so the EntryEditModal's bubble-listener dirty
            check sees the native change event (the input bubbles `change`,
            unlike a portalled popup control). */}
        <div className="flex flex-col items-start gap-2">
          <label htmlFor={fieldId('date')} className="text-muted-foreground text-xs">
            {t('entries.editor.date')}
          </label>
          <Input
            {...noAutofill('entry-date')}
            id={fieldId('date')}
            type="date"
            className="w-44"
            aria-label={t('entries.editor.date')}
            {...register('date')}
          />
          {errors.date?.message && (
            <p className="text-destructive text-xs" role="alert">
              {tMsg(errors.date.message)}
            </p>
          )}
        </div>

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

        {/* Hours + Minutes + EndTime (derived). Editing either pair updates
            the other so users can declare duration explicitly OR pick when
            the entry finished and let the form back-solve. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <label htmlFor={fieldId('hours')} className="text-muted-foreground text-xs">
              {t('entries.editor.hours')}
            </label>
            <Input
              {...noAutofill('entry-hours')}
              id={fieldId('hours')}
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
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
              {...noAutofill('entry-minutes')}
              id={fieldId('minutes')}
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              min={0}
              max={59}
              className="w-20"
              {...register('minutes', { valueAsNumber: true })}
            />
          </div>
          <div className="flex flex-col items-start gap-2">
            <label htmlFor={fieldId('endMinutes')} className="text-muted-foreground text-xs">
              {t('entries.endTime')}
            </label>
            <TimeInput
              id={fieldId('endMinutes')}
              value={derivedEndMinutes}
              onChange={handleEndChange}
              aria-label={t('entries.endTime')}
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
                  {...noAutofill('entry-custom-payment')}
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
            className="border-input focus-visible:ring-ring placeholder:text-muted-foreground flex w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
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
                  .then(() => {
                    // Neutral "queued" copy — the op has been enqueued, but
                    // the actual sync runs asynchronously and may still fail.
                    // The previous unconditional `toast.success` fired before
                    // the enqueue resolved, falsely signalling success.
                    toast.success(t('googleCalendar.retryQueued'));
                  })
                  .catch((err: unknown) => {
                    console.warn('[EntryEditor] retry enqueue failed', err);
                    toast.error(t('googleCalendar.syncError'));
                  });
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
            <Button type="submit" size="sm" disabled={!isDirty || isSaving}>
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
