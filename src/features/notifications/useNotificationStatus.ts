import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import i18n from '@/lib/i18n/i18n';

import { readNotificationsEnabled, writeNotificationsEnabled } from './notificationPrefs';
import {
  getNotificationStatus,
  isNotificationSupported,
  type NotificationStatus,
} from './notificationSupport';
import { showTestNotification } from './showReminderNotification';

export interface UseNotificationStatusResult {
  status: NotificationStatus;
  /** Must run from a user tap: the browser ignores a permission request without one (FR-002). */
  enable: () => Promise<void>;
  disable: () => void;
  sendTest: () => Promise<void>;
}

/**
 * State + actions behind Settings → Notifications (spec 013). The permission
 * can change outside the app (phone settings), so it is re-read whenever the
 * app returns to the foreground.
 */
export function useNotificationStatus(): UseNotificationStatusResult {
  const [status, setStatus] = useState<NotificationStatus>(() =>
    getNotificationStatus(readNotificationsEnabled()),
  );
  const refresh = useCallback(() => {
    setStatus(getNotificationStatus(readNotificationsEnabled()));
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh]);

  const enable = useCallback(async () => {
    if (!isNotificationSupported()) return;
    try {
      const permission =
        Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;
      if (permission === 'granted') writeNotificationsEnabled(true);
    } catch (err) {
      console.error('[useNotificationStatus] permission request failed', err);
      toast.error(i18n.t('settings.notifications.enableFailed'));
    }
    refresh();
  }, [refresh]);

  const disable = useCallback(() => {
    writeNotificationsEnabled(false);
    refresh();
  }, [refresh]);

  const sendTest = useCallback(async () => {
    try {
      if (await showTestNotification()) return;
      toast.error(i18n.t('settings.notifications.testUnavailable'));
    } catch (err) {
      console.error('[useNotificationStatus] test notification failed', err);
      toast.error(i18n.t('settings.notifications.testFailed'));
    }
  }, []);

  return { status, enable, disable, sendTest };
}
