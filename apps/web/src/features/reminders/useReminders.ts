import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { Reminder } from '@hourtrack/shared-types';

import {
  createReminder,
  db,
  deleteReminder,
  isReminderDue,
  listOpenReminders,
  updateReminder,
} from '@/lib/db';
import { getSyncManager } from '@/features/sync/SyncManager';

/**
 * TanStack Query hooks for Reminders (S28). Mirrors the `usePayments` /
 * `useEntries` pattern: each hook wraps a pure `db`-first query function and
 * passes the singleton `db`; mutations write, invalidate, then fire-and-forget
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

export const REMINDERS_QUERY_KEY = ['reminders'] as const;
const OPEN_KEY = ['reminders', 'open'] as const;

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
 * current `Date` in the component so "due" tracks wall-clock without a refetch.
 */
export function useOpenRemindersQuery(): UseQueryResult<Reminder[]> {
  return useQuery({
    queryKey: OPEN_KEY,
    queryFn: () => listOpenReminders(db),
  });
}

type ReminderCreateInput = Pick<Reminder, 'text' | 'dueDate' | 'dueMinutes'>;

export function useCreateReminderMutation(): UseMutationResult<
  Reminder,
  Error,
  ReminderCreateInput
> {
  const qc = useQueryClient();
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
      void qc.invalidateQueries({ queryKey: REMINDERS_QUERY_KEY });
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateReminderArgs) => updateReminder(db, id, patch),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: REMINDERS_QUERY_KEY });
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => updateReminder(db, id, { doneAt: new Date().toISOString() }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: REMINDERS_QUERY_KEY });
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => updateReminder(db, id, { notifiedAt: new Date().toISOString() }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: REMINDERS_QUERY_KEY });
      enqueueReminderPush('update', updated.id);
    },
  });
}

export function useDeleteReminderMutation(): UseMutationResult<Reminder | null, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteReminder(db, id),
    onSuccess: (deleted) => {
      void qc.invalidateQueries({ queryKey: REMINDERS_QUERY_KEY });
      if (deleted) {
        enqueueReminderPush('delete', deleted.id);
        // Always clean up the Calendar event on an explicit delete — no orphans.
        enqueueDeleteReminderEvent(deleted.id, deleted.googleEventId);
      }
    },
  });
}
