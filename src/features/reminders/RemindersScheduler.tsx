import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Reminder } from '@/shared/types';

import { db, listOpenReminders } from '@/lib/db';
import { readNotificationsEnabled } from '@/features/notifications/notificationPrefs';
import { getNotificationStatus } from '@/features/notifications/notificationSupport';
import {
  closeStaleReminderNotifications,
  showReminderNotification,
} from '@/features/notifications/showReminderNotification';

import { selectDueToasts } from './reminderScheduling';
import { useMarkReminderDoneMutation, useMarkReminderNotifiedMutation } from './useReminders';

/**
 * S28 — invisible mount-once component that toasts reminders which cross due
 * WHILE the app is open (task 13, AutoBackupScheduler pattern).
 *
 * Lifecycle:
 *   - check on mount + every 60s (`setInterval`) + on `visibilitychange`
 *     (returning to the tab). A 60s tick bounds the toast latency; reminders
 *     have minute granularity so this is plenty.
 *
 * What fires a toast: a reminder that is NOT done, has NOT been notified
 * (`notifiedAt === null`), and whose due moment fell between when THIS
 * scheduler mounted (`startedAtRef`) and now. Reminders already due at mount
 * are the DueRemindersBanner's job, not the toast's — this keeps the two
 * surfaces from double-firing for the same reminder on open.
 *
 * De-dupe: after toasting we stamp `notifiedAt` so the reminder pings exactly
 * once, across the 60s tick AND multiple tabs (the stamp rides the Drive
 * snapshot). An `inFlightRef` prevents a slow tick from overlapping the next.
 *
 * Spec 013: while the app is HIDDEN and the device has notifications on, the
 * ping is a system notification instead of the toast (a visible app gets the
 * toast only). If it cannot be posted, the toast is the fallback so the
 * reminder is never lost. Each tick also closes the notifications of
 * reminders that are no longer open.
 *
 * Render: nothing.
 */

const TICK_MS = 60_000;

/** `false` (caller toasts instead) when there is no service worker or posting fails. */
async function postSystemNotification(reminder: Reminder): Promise<boolean> {
  try {
    return await showReminderNotification(reminder);
  } catch (err) {
    console.warn('[RemindersScheduler] system notification failed, toasting instead', err);
    return false;
  }
}

export function RemindersScheduler() {
  const { t } = useTranslation();
  const markNotified = useMarkReminderNotifiedMutation();
  const markDone = useMarkReminderDoneMutation();

  const inFlightRef = useRef(false);
  const startedAtRef = useRef<number>(Date.now());

  // Stable refs to the mutations so the interval closure never goes stale.
  const notifiedRef = useRef(markNotified);
  notifiedRef.current = markNotified;
  const doneRef = useRef(markDone);
  doneRef.current = markDone;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const now = Date.now();
        const open = await listOpenReminders(db);
        const toToast = selectDueToasts(open, startedAtRef.current, now);
        const notifyOs =
          document.visibilityState === 'hidden' &&
          getNotificationStatus(readNotificationsEnabled()) === 'on';
        for (const r of toToast) {
          if (cancelled) break;
          // Both mutations report their own failures (hook-level onError).
          notifiedRef.current.mutate(r.id);
          if (notifyOs && (await postSystemNotification(r))) continue;
          toast(tRef.current('reminders.toast.due', { text: r.text }), {
            action: {
              label: tRef.current('reminders.done'),
              onClick: () => doneRef.current.mutate(r.id),
            },
          });
        }
        closeStaleReminderNotifications(new Set(open.map((r) => r.id))).catch((err: unknown) =>
          console.warn('[RemindersScheduler] closing stale notifications failed', err),
        );
      } catch (err) {
        console.warn('[RemindersScheduler] tick failed', err);
      } finally {
        inFlightRef.current = false;
      }
    };

    void tick();
    const interval = setInterval(() => void tick(), TICK_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
