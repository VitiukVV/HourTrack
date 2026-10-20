import i18n from '@/lib/i18n/i18n';

import { getSwRegistration } from './notificationSupport';

/**
 * Posting and tidying the reminder system notifications (spec 013). Every
 * reminder notification is tagged `reminder:<id>`: the OS collapses a second
 * post with the same tag (two open tabs) into one entry, and the tag is how a
 * stale one is found again. `public/sw-notifications.js` reads `data.reminderId`
 * and the `done` action on click.
 */
const REMINDER_TAG_PREFIX = 'reminder:';
const ICON = '/icons/pwa-192x192.png';

/** `actions` is valid for service-worker notifications but missing from the DOM lib typings. */
type SwNotificationOptions = NotificationOptions & {
  actions?: { action: string; title: string }[];
};

/** Resolves `false` when there is no service worker to post through. */
export async function showReminderNotification(reminder: {
  id: string;
  text: string;
}): Promise<boolean> {
  const registration = await getSwRegistration();
  if (!registration) return false;
  const options: SwNotificationOptions = {
    body: reminder.text,
    tag: `${REMINDER_TAG_PREFIX}${reminder.id}`,
    data: { reminderId: reminder.id },
    icon: ICON,
    actions: [{ action: 'done', title: i18n.t('reminders.done') }],
  };
  await registration.showNotification(i18n.t('reminders.notification.title'), options);
  return true;
}

export async function showTestNotification(): Promise<boolean> {
  const registration = await getSwRegistration();
  if (!registration) return false;
  await registration.showNotification(i18n.t('reminders.notification.testTitle'), {
    body: i18n.t('reminders.notification.testBody'),
    tag: 'test',
    icon: ICON,
  });
  return true;
}

/** Close reminder notifications whose reminder is no longer open (done or deleted). */
export async function closeStaleReminderNotifications(openIds: ReadonlySet<string>): Promise<void> {
  const registration = await getSwRegistration();
  if (!registration) return;
  const shown = await registration.getNotifications();
  for (const notification of shown) {
    if (!notification.tag.startsWith(REMINDER_TAG_PREFIX)) continue;
    if (!openIds.has(notification.tag.slice(REMINDER_TAG_PREFIX.length))) notification.close();
  }
}
