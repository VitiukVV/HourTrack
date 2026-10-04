import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { Reminder } from '@hourtrack/shared-types';

import {
  createReminder,
  db,
  deleteReminder,
  isReminderDue,
  listOpenReminders,
  updateReminder,
} from '@/lib/db';
import { useLiveRead, type LiveRead } from '@/lib/db/useLiveRead';
import i18n from '@/lib/i18n/i18n';
import { getSyncManager } from '@/features/sync/SyncManager';

/**
 * Hooks for Reminders (S28). Mirrors the `usePayments` /
 * `useEntries` pattern: each hook wraps a pure `db`-first query function and
 * passes the singleton `db`; mutations write, then fire-and-forget
 * both a Drive `pushDataJson` and (where relevant) a Calendar op.
 *
 * Calendar op wiring:
 *   - create  → `createReminderEvent`
 *   - edit    → `updateReminderEvent` (handler PATCHes if a googleEventId
 *               exists, else creates)
 *   - done    → `deleteReminderEvent` ONLY when the due time is still in the
 *               future (done-before-due must not leave a stale event); a
 *               past-due done needs no Calendar call
 *   - delete  → `deleteReminderEvent` (always — no orphan events)
 */

/** Notify the SyncManager that a reminder change should push to Drive. */
function enqueueReminderPush(mutation: 'create' | 'update' | 'delete', reminderId: string): void {
  void getSyncManager()
    .enqueue({ op: 'pushDataJson', mutation, entityType: 'reminder', entityId: reminderId })
    .catch((err: unknown) => {
      console.warn('[useReminders] enqueue sync failed', err);
    });
}

function enqueueCreateReminderEvent(reminderId: string): void {
  void getSyncManager()
    .enqueue({ op: 'createReminderEvent', entityType: 'reminder', entityId: reminderId })
    .catch((err: unknown) => {
      console.warn('[useReminders] enqueue createReminderEvent failed', err);
    });
}

function enqueueUpdateReminderEvent(reminderId: string): void {
  void getSyncManager()
    .enqueue({ op: 'updateReminderEvent', entityType: 'reminder', entityId: reminderId })
    .catch((err: unknown) => {
      console.warn('[useReminders] enqueue updateReminderEvent failed', err);
    });
}

function enqueueDeleteReminderEvent(reminderId: string, googleEventId: string | null): void {
  if (!googleEventId) return;
  void getSyncManager()
    .enqueue({
      op: 'deleteReminderEvent',
      entityType: 'reminder',
      entityId: reminderId,
      payload: { googleEventId },
    })
    .catch((err: unknown) => {
      console.warn('[useReminders] enqueue deleteReminderEvent failed', err);
    });
}

/**
 * All open (not-done) reminders, soonest-due first. Drives the bell list; the
 * bell badge + due banner classify this list with `isReminderDue` against a
 * current `Date` in the component so "due" tracks wall-clock without a re-read.
 */
export function useOpenRemindersQuery(): LiveRead<Reminder[]> {
  return useLiveRead('reminders:open', () => listOpenReminders(db));
}

type ReminderCreateInput = Pick<Reminder, 'text' | 'dueDate' | 'dueMinutes'>;

export function useCreateReminderMutation(): UseMutationResult<
  Reminder,
  Error,
  ReminderCreateInput
> {
  return useMutation({
    mutationFn: (input: ReminderCreateInput) =>
      createReminder(db, {
        id: crypto.randomUUID(),
        text: input.text,
        dueDate: input.dueDate,
        dueMinutes: input.dueMinutes,
        doneAt: null,
        googleEventId: null,
        syncStatus: 'pending',
        syncError: null,
        notifiedAt: null,
      }),
    onSuccess: (created) => {
      enqueueReminderPush('create', created.id);
      enqueueCreateReminderEvent(created.id);
    },
  });
}

interface UpdateReminderArgs {
  id: string;
  patch: Pick<Reminder, 'text' | 'dueDate' | 'dueMinutes'>;
}

export function useUpdateReminderMutation(): UseMutationResult<
  Reminder,
  Error,
  UpdateReminderArgs
> {
  return useMutation({
    mutationFn: ({ id, patch }: UpdateReminderArgs) => updateReminder(db, id, patch),
    onSuccess: (updated) => {
      enqueueReminderPush('update', updated.id);
      // Reflect the text/date/time change on the Calendar event. The handler
      // PATCHes when a googleEventId exists, else creates.
      enqueueUpdateReminderEvent(updated.id);
    },
  });
}

/**
 * Mark a reminder done. Sets `doneAt` and, when the due moment is still in the
 * FUTURE, deletes the Calendar event so a collected-early reminder doesn't
 * linger/ping later (the worst UX bug this feature can ship). A past-due done
 * needs no Calendar call. If the create op hasn't synced yet (no
 * googleEventId), the create handler's `doneAt` guard prevents a stale event.
 */
export function useMarkReminderDoneMutation(): UseMutationResult<Reminder, Error, string> {
  return useMutation({
    mutationFn: (id: string) => updateReminder(db, id, { doneAt: new Date().toISOString() }),
    // Hook-level (spec 007): a per-call `onError` only runs for the LATEST
    // `mutate` on the observer, so two quick "Done" taps would lose one.
    onError: (err) => {
      console.error('[useReminders] mark done failed:', err);
      toast.error(i18n.t('reminders.actionFailed'));
    },
    onSuccess: (updated) => {
      enqueueReminderPush('update', updated.id);
      const dueInFuture = !isReminderDue(updated, new Date());
      if (dueInFuture) {
        enqueueDeleteReminderEvent(updated.id, updated.googleEventId);
      }
    },
  });
}

/**
 * Record that the while-open scheduler fired a toast for this reminder, so it
 * pings only once (guarded across the 60s tick + multiple tabs). No Calendar
 * op — this is a local-notification bookkeeping stamp that still rides the Drive
 * snapshot so sibling tabs/devices don't re-toast.
 */
export function useMarkReminderNotifiedMutation(): UseMutationResult<Reminder, Error, string> {
  return useMutation({
    mutationFn: (id: string) => updateReminder(db, id, { notifiedAt: new Date().toISOString() }),
    // A failed stamp only means the reminder may toast again next tick.
    onError: (err) => console.error('[useReminders] notified stamp failed:', err),
    onSuccess: (updated) => {
      enqueueReminderPush('update', updated.id);
    },
  });
}

export function useDeleteReminderMutation(): UseMutationResult<Reminder | null, Error, string> {
  return useMutation({
    mutationFn: (id: string) => deleteReminder(db, id),
    onSuccess: (deleted) => {
      if (deleted) {
        enqueueReminderPush('delete', deleted.id);
        // Always clean up the Calendar event on an explicit delete — no orphans.
        enqueueDeleteReminderEvent(deleted.id, deleted.googleEventId);
      }
    },
  });
}
