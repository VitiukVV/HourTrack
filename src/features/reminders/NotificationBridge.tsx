import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { db, getReminderById } from '@/lib/db';
import i18n from '@/lib/i18n/i18n';

import { useMarkReminderDoneMutation } from './useReminders';
import { useReminderBellStore } from './useReminderBellStore';

/**
 * Spec 013 — the app side of `public/sw-notifications.js`. A notification
 * click reaches the app either as a service worker message (a window was
 * open) or as launch URL params (it was not); both end in the same two
 * actions: mark the reminder done through the regular mutation (same Drive +
 * Calendar side effects as the bell's «Done»), or open the bell's list.
 *
 * Render: nothing.
 */
const DONE_PARAM = 'reminderDone';
const OPEN_PARAM = 'openReminders';

export function NotificationBridge() {
  const markDone = useMarkReminderDoneMutation();
  const markDoneRef = useRef(markDone);
  markDoneRef.current = markDone;
  const setBellOpen = useReminderBellStore((s) => s.setOpen);
  const [searchParams, setSearchParams] = useSearchParams();

  // Ids already sent to `markDone`: a StrictMode double effect or a message
  // racing the launch URL must not complete (push + Calendar op) twice.
  const completedRef = useRef(new Set<string>());

  const completeReminder = useCallback((id: string) => {
    if (completedRef.current.has(id)) return;
    completedRef.current.add(id);
    getReminderById(db, id)
      .then((reminder) => {
        // Completed or deleted elsewhere since the notification was posted.
        if (!reminder || reminder.doneAt !== null) return;
        markDoneRef.current.mutate(id);
      })
      .catch((err: unknown) => {
        completedRef.current.delete(id);
        console.error('[NotificationBridge] could not complete reminder', err);
        toast.error(i18n.t('reminders.actionFailed'));
      });
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null || !('type' in data)) return;
      if (data.type === 'hourtrack:open-reminders') setBellOpen(true);
      else if (
        data.type === 'hourtrack:reminder-done' &&
        'id' in data &&
        typeof data.id === 'string'
      ) {
        // Tell the SW the tap arrived; without this ack it re-shows the notification.
        event.ports[0]?.postMessage({ ok: true });
        completeReminder(data.id);
      }
    };
    const container = navigator.serviceWorker;
    container.addEventListener('message', onMessage);
    return () => container.removeEventListener('message', onMessage);
  }, [completeReminder, setBellOpen]);

  useEffect(() => {
    const doneId = searchParams.get(DONE_PARAM);
    const openList = searchParams.has(OPEN_PARAM);
    if (!doneId && !openList) return;
    if (doneId) completeReminder(doneId);
    if (openList) setBellOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(DONE_PARAM);
        next.delete(OPEN_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams, completeReminder, setBellOpen]);

  return null;
}
