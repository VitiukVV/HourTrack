import type { Reminder } from '@hourtrack/shared-types';

/**
 * Pure scheduling helpers for the while-open reminder toast (S28, task 13).
 * Kept in a non-component module so `RemindersScheduler.tsx` stays a
 * component-only file (react-refresh) and so this logic is unit-testable with
 * no timers / no DB.
 */

/** Local-time epoch ms for a reminder's due moment (`YYYY-MM-DD` + minutes). */
export function reminderDueMomentMs(reminder: Reminder): number {
  const [y, m, d] = reminder.dueDate.split('-').map(Number);
  const hours = Math.floor(reminder.dueMinutes / 60);
  const minutes = reminder.dueMinutes % 60;
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hours, minutes, 0, 0).getTime();
}

/**
 * From a list of reminders, pick those the scheduler should toast right now: a
 * reminder qualifies when it is not done, not yet notified, and its due moment
 * fell within `[startedAtMs, nowMs]` — i.e. it crossed due while the app was
 * open. Reminders already due before `startedAtMs` are the DueRemindersBanner's
 * job and are excluded here.
 */
export function selectDueToasts(
  reminders: Reminder[],
  startedAtMs: number,
  nowMs: number,
): Reminder[] {
  return reminders.filter((r) => {
    if (r.doneAt !== null) return false;
    if (r.notifiedAt !== null) return false;
    const due = reminderDueMomentMs(r);
    return due >= startedAtMs && due <= nowMs;
  });
}
