import type { Reminder } from '@hourtrack/shared-types';

import type { HourTrackDB } from '../schema';
import { deleteWithTombstone, nowIso, patchRow } from '../mutate';

/** Zero-padded `YYYY-MM-DD` local date + minutes-since-midnight for `now`. */
function localDateAndMinutes(now: Date): { date: string; minutes: number } {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return { date: `${y}-${mo}-${d}`, minutes: now.getHours() * 60 + now.getMinutes() };
}

/** A minute of the day: an integer in `[0, 1439]`. */
function isValidDueMinutes(dueMinutes: number): boolean {
  return Number.isInteger(dueMinutes) && dueMinutes >= 0 && dueMinutes <= 1439;
}

/**
 * Pure predicate: true when a reminder's due moment is at or before `now`
 * (local terms). Exported so the bell badge / banner can classify an
 * already-loaded open-reminders list without a second DB round-trip, and so
 * the mark-done flow can decide whether the Calendar event still needs
 * deleting (future due) or can be left alone (past due).
 */
export function isReminderDue(reminder: Reminder, now: Date): boolean {
  const { date, minutes } = localDateAndMinutes(now);
  if (reminder.dueDate < date) return true;
  if (reminder.dueDate > date) return false;
  return reminder.dueMinutes <= minutes;
}

/**
 * ALL reminders across every date. Used by the S28 snapshot builder so
 * reminders ride the Drive `data.json` sync. Sorted by `id` for a stable,
 * deterministic ordering (snapshot round-trip tests depend on it).
 */
export async function getAllReminders(db: HourTrackDB): Promise<Reminder[]> {
  const rows = await db.reminders.toArray();
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

/**
 * Open (not-done) reminders, soonest due first. Drives the bell list. Sorted
 * by `dueDate` then `dueMinutes` ascending, then `createdAt` as a stable
 * tiebreaker.
 */
export async function listOpenReminders(db: HourTrackDB): Promise<Reminder[]> {
  const rows = await db.reminders.filter((r) => r.doneAt === null).toArray();
  rows.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.dueMinutes !== b.dueMinutes) return a.dueMinutes - b.dueMinutes;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return rows;
}

/**
 * Due, not-done reminders as of `now` — `dueDate + dueMinutes <= now` (local
 * terms) AND `doneAt === null`. Drives the bell badge, the open-app banner, and
 * the while-open scheduler. Sorted soonest-due first.
 */
export async function listDueReminders(
  db: HourTrackDB,
  now: Date = new Date(),
): Promise<Reminder[]> {
  const open = await listOpenReminders(db);
  return open.filter((r) => isReminderDue(r, now));
}

export async function getReminderById(db: HourTrackDB, id: string): Promise<Reminder | undefined> {
  return db.reminders.get(id);
}

export async function createReminder(
  db: HourTrackDB,
  input: Omit<Reminder, 'createdAt' | 'updatedAt'>,
): Promise<Reminder> {
  if (input.text.trim().length === 0) {
    throw new Error('createReminder: text must not be empty');
  }
  if (!isValidDueMinutes(input.dueMinutes)) {
    throw new Error(`createReminder: dueMinutes out of range: ${input.dueMinutes}`);
  }
  const now = nowIso();
  const reminder: Reminder = { ...input, createdAt: now, updatedAt: now };
  await db.reminders.add(reminder);
  return reminder;
}

/**
 * Apply a partial patch and stamp a fresh `updatedAt`. Throws if the reminder
 * does not exist. `dueMinutes` (when present) must stay in `[0, 1439]`.
 */
export async function updateReminder(
  db: HourTrackDB,
  id: string,
  patch: Partial<Omit<Reminder, 'id' | 'createdAt'>>,
): Promise<Reminder> {
  // S31 (UR-31-4): atomic get→merge→put in one `rw` transaction (see updateCard).
  return patchRow(db.reminders, id, patch, 'updateReminder: reminder not found', (next) => {
    if (!isValidDueMinutes(next.dueMinutes)) {
      throw new Error(`updateReminder: dueMinutes out of range: ${next.dueMinutes}`);
    }
  });
}

/**
 * Delete a reminder and record a tombstone (`entityType: 'reminder'`). The
 * tombstone propagates the delete to other devices via the next Drive snapshot
 * — without it a remote device would treat the absence as "not yet synced" and
 * re-add its stale copy. Returns the deleted reminder (carrying `googleEventId`
 * so the caller can enqueue the matching `deleteReminderEvent` op) or `null`
 * if it didn't exist (delete is idempotent).
 */
export async function deleteReminder(db: HourTrackDB, id: string): Promise<Reminder | null> {
  return deleteWithTombstone(db, db.reminders, 'reminder', id);
}
