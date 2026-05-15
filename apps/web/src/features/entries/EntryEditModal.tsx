import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { Entry } from '@hourtrack/shared-types';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { db, getEntriesByCardId } from '@/lib/db';
import { useCardQuery } from '@/features/cards/useCards';

import { EntryEditor } from './EntryEditor';
import { useEntryByIdQuery } from './useEntries';

/**
 * S17 — Inline entry edit modal.
 *
 * Wraps the existing `EntryEditor` form in a Radix Dialog. Mounted ONCE per
 * calendar root (MonthView / WeekView) and driven by per-view local state
 * (`useState<string | null>`) — no Zustand slice. When `entryId` is null
 * the modal is hidden; when non-null + `open=true` it loads the entry +
 * card + per-card entry list and renders the editor.
 *
 * Lifecycle:
 *   1. Chip click → parent setState(entryId) → `open=true`.
 *   2. Radix Dialog mounts → auto-focuses the first input (handled by Radix).
 *   3. User edits + clicks Save → `EntryEditor.onSaved` fires → modal closes
 *      (parent state cleared via `onOpenChange(false)`).
 *   4. User clicks Cancel / hits Esc / clicks the overlay:
 *      - If form is clean → close immediately.
 *      - If form is dirty → open the inline "Discard changes?" confirm. Only
 *        when the user confirms does the modal close.
 *   5. Delete via the footer button → existing `useDeleteEntryMutation` →
 *      modal closes once the row is gone.
 *
 * `EntryEditor` is used unmodified in shape — we only pass the three
 * S17-additive props (`onSaved`, `onCancelClick`, `hideDelete`) so DayPage's
 * call site stays untouched.
 *
 * NOTE on the dirty-check: react-hook-form lives INSIDE EntryEditor, so the
 * modal can't read `formState.isDirty` directly. Instead we treat the user's
 * Cancel-button / Esc / outside-click signal as "ask first", and if the
 * dialog has been open long enough that the user MIGHT have typed something,
 * we surface the confirm. The actual dirty-bit lives inside EntryEditor; we
 * mirror it via a callback. To keep the API minimal we instead infer dirty
 * by listening for a one-shot "user touched the form" signal. This is the
 * pragmatic shape: an explicit `formDirty` ref synced via a tiny prop.
 *
 * For S17 we implement the simpler equivalent: cap the dirty surface to the
 * Cancel button (Esc + overlay click also route through Cancel via the
 * Radix Dialog `onOpenChange`). The EntryEditor's own `isDirty` is observed
 * via a new optional callback — `onDirtyChange` — that mirrors RHF's
 * `formState.isDirty` upward. The callback is invoked on each form mutation
 * via a `useEffect(... [isDirty])` inside the editor. Adding it as a fourth
 * optional prop felt heavy; instead we track dirty via a controlled-input
 * proxy here.
 */

interface EntryEditModalProps {
  /** When null, the modal does not render anything (Radix `open=false`). */
  entryId: string | null;
  open: boolean;
  /**
   * Standard Radix-style controlled-open setter. The parent calendar view
   * passes `(next) => !next && setEditingEntryId(null)` to clear its
   * per-view editing state.
   */
  onOpenChange: (open: boolean) => void;
}

export function EntryEditModal({ entryId, open, onOpenChange }: EntryEditModalProps) {
  const { t } = useTranslation();

  // Resets per (open, entryId) cycle. Tracks whether the user has edited
  // anything inside the form since the modal opened. EntryEditor's RHF state
  // is what's actually authoritative — but exposing it as a fourth prop on
  // EntryEditor (`onDirtyChange`) would force every page-mode caller to pass
  // a no-op. Instead we observe form changes via a bubble listener on the
  // dialog content (every controlled input fires `change` events that bubble
  // out of the form element). This is the smallest-surface dirty signal:
  // any user input flips the flag, and it resets when the modal closes.
  const [dirty, setDirty] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  // Reset dirty flag whenever we open a fresh entry. Without this, opening
  // a second entry after the first one was saved would inherit the previous
  // flag (the listener doesn't auto-clear).
  useEffect(() => {
    if (open && entryId) {
      setDirty(false);
      setConfirmDiscardOpen(false);
    }
  }, [open, entryId]);

  const entryQuery = useEntryByIdQuery(entryId);
  const entry = entryQuery.data;
  const cardQuery = useCardQuery(entry?.cardId);
  const card = cardQuery.data;

  // Per-card entries for the EntryEditor earnings preview. Mirrors the
  // DayPage's private `useEntriesByCardQuery` — fixed-rate cards need the
  // full per-card scope to compute the proportional split.
  const cardEntriesQuery = useQuery<Entry[]>({
    queryKey: ['entries', 'by-card', entry?.cardId ?? null],
    queryFn: () => (entry?.cardId ? getEntriesByCardId(db, entry.cardId) : Promise.resolve([])),
    enabled: !!entry?.cardId,
  });
  const allCardEntries = cardEntriesQuery.data ?? (entry ? [entry] : []);

  // Cancel / outside-click / Esc path. Routed through the Radix
  // `onOpenChange(false)` callback as well as the modal's own Cancel button
  // (via `EntryEditor.onCancelClick`).
  const attemptClose = () => {
    if (dirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      attemptClose();
      return;
    }
    onOpenChange(true);
  };

  const handleConfirmDiscard = () => {
    setConfirmDiscardOpen(false);
    setDirty(false);
    onOpenChange(false);
  };

  // Bubbling `input`/`change` listener that flips `dirty` on first user
  // input. Cheaper than threading an onDirtyChange prop through EntryEditor
  // and equally accurate: any user keystroke inside any input/textarea/
  // switch propagates here.
  const handleFormInput = () => {
    if (!dirty) setDirty(true);
  };

  return (
    <>
      <Dialog open={open && !!entryId} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          // S17: trap form-input events at the dialog root so dirty-state
          // tracking is one bubble away from every controlled input inside
          // the EntryEditor without modifying the editor's contract.
          onInput={handleFormInput}
          onChange={handleFormInput}
          // While the discard-confirm dialog is open, swallow outside/Esc on
          // the parent dialog — otherwise a click on the confirm's overlay
          // would also fire on the parent and re-attempt close (creating a
          // confirm-on-confirm loop).
          onInteractOutside={(e) => {
            if (confirmDiscardOpen) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (confirmDiscardOpen) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('entryEdit.title', { card: card?.name ?? '…' })}</DialogTitle>
          </DialogHeader>

          {entry && (
            <EntryEditor
              entry={entry}
              card={card}
              allCardEntries={allCardEntries}
              onSaved={() => {
                // Successful save → drop dirty + close. Parent clears its
                // editingEntryId on the same tick.
                setDirty(false);
                onOpenChange(false);
              }}
              onCancelClick={attemptClose}
              // Delete is owned by EntryEditor's existing ConfirmDialog flow
              // (clicking the inline Delete button opens the confirm; the
              // mutation then runs). The modal does NOT render its own
              // delete button — we keep EntryEditor's destructive button
              // visible so the user can delete-from-modal with the same
              // double-confirm guarantee.
              hideDelete={false}
              onDeleted={() => {
                setDirty(false);
                onOpenChange(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDiscardOpen}
        onOpenChange={(o) => {
          if (!o) setConfirmDiscardOpen(false);
        }}
        title={t('entryEdit.discardChanges.title')}
        body={t('entryEdit.discardChanges.body')}
        confirmLabel={t('entryEdit.discardChanges.confirm')}
        cancelLabel={t('entryEdit.discardChanges.cancel')}
        confirmVariant="destructive"
        onConfirm={handleConfirmDiscard}
      />
    </>
  );
}
