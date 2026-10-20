/**
 * HourTrack — reminder notification clicks (spec 013).
 *
 * Pulled into the generated Workbox service worker by `workbox.importScripts`
 * in `vite.config.ts`; plain JS because it is served as-is, not bundled. The
 * app owns all reminder logic: this file only routes the click to an open
 * window (`NotificationBridge` handles the message) or opens one carrying the
 * request in the URL (`?reminderDone=<id>` / `?openReminders=1`; a bare `/`
 * for the test notification).
 */

/** How long an open window gets to confirm it took a «Done» before the notification comes back. */
const ACK_TIMEOUT_MS = 2000;

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    handleNotificationClick(event.notification, event.action).catch((err) =>
      console.error('[sw-notifications] notification click failed', err),
    ),
  );
});

async function handleNotificationClick(notification, action) {
  const reminderId = notification.data?.reminderId;
  // Most recently focused first, so the message reaches the window the user last used.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = windows[0];

  if (action === 'done' && reminderId) {
    // With a window open, «Done» is handled there without focusing it; with
    // none, a window has to be opened to run the mutation. A window that does
    // not confirm (sign-in screen, frozen in the background) gets the
    // notification back, so the tap is never silently lost.
    if (client) {
      const message = { type: 'hourtrack:reminder-done', id: reminderId };
      if (!(await postWithAck(client, message))) await reshow(notification);
      return;
    }
    const opened = await self.clients.openWindow(
      '/?reminderDone=' + encodeURIComponent(reminderId),
    );
    if (!opened) await reshow(notification);
    return;
  }

  if (client) {
    await client.focus();
    if (reminderId) client.postMessage({ type: 'hourtrack:open-reminders' });
    return;
  }
  await self.clients.openWindow(reminderId ? '/?openReminders=1' : '/');
}

/** Resolves `true` once the window replies on the transferred port, `false` after the timeout. */
function postWithAck(client, message) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), ACK_TIMEOUT_MS);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    client.postMessage(message, [channel.port2]);
  });
}

function reshow(notification) {
  return self.registration.showNotification(notification.title, {
    body: notification.body,
    tag: notification.tag,
    data: notification.data,
    icon: notification.icon,
    actions: notification.actions,
  });
}
