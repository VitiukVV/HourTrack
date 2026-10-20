/**
 * What the Settings section shows and whether the scheduler may post a system
 * notification (spec 013, FR-001). `blocked` wins over the per-device switch:
 * once the user denied the permission only the phone's settings can undo it.
 */
export type NotificationStatus = 'unsupported' | 'off' | 'on' | 'blocked';

/** Posting goes through the service worker — `new Notification()` throws on Android Chrome. */
export function isNotificationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator
  );
}

export function getNotificationStatus(enabled: boolean): NotificationStatus {
  if (!isNotificationSupported()) return 'unsupported';
  const permission = Notification.permission;
  if (permission === 'denied') return 'blocked';
  return permission === 'granted' && enabled ? 'on' : 'off';
}

/**
 * The app's service worker registration, or `undefined` when there is none:
 * dev (the SW is disabled), an unsupported browser, or a failed lookup.
 */
export async function getSwRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!isNotificationSupported()) return undefined;
  try {
    return await navigator.serviceWorker.getRegistration();
  } catch (err) {
    console.warn('[notifications] service worker registration unavailable', err);
    return undefined;
  }
}
