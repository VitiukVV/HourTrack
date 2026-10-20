/**
 * HourTrack — reminder notification clicks (spec 013).
 *
 * Pulled into the generated Workbox service worker by `workbox.importScripts`
 * in `vite.config.ts`; plain JS because it is served as-is, not bundled. The
 * app owns all reminder logic: this file only routes the click to an open
 * window (`NotificationBridge` handles the message) or opens one with the
 * same request in the URL.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(handleNotificationClick(event.notification, event.action));
});

async function handleNotificationClick(notification, action) {
  const reminderId = notification.data ? notification.data.reminderId : undefined;
  // Most recently focused first, so the message reaches the window the user last used.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = windows[0];

  if (action === 'done' && reminderId) {
    // No focus: «Done» should not pull the app to the front.
    if (client) client.postMessage({ type: 'hourtrack:reminder-done', id: reminderId });
    else await self.clients.openWindow('/?reminderDone=' + encodeURIComponent(reminderId));
    return;
  }

  if (client) {
    await client.focus();
    if (reminderId) client.postMessage({ type: 'hourtrack:open-reminders' });
    return;
  }
  await self.clients.openWindow(reminderId ? '/?openReminders=1' : '/');
}
