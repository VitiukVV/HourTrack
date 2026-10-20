import { describe, expect, it, vi } from 'vitest';

import source from '../../../public/sw-notifications.js?raw';

/**
 * Spec 013 — `public/sw-notifications.js` runs inside the generated Workbox
 * service worker, outside the bundle. The test evaluates its source against a
 * fake `self` and fires `notificationclick` at it.
 */

interface FakeClient {
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

function loadWorker(windows: FakeClient[]) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const clients = {
    matchAll: vi.fn(() => Promise.resolve(windows)),
    openWindow: vi.fn(() => Promise.resolve(null)),
  };
  const self = {
    clients,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
  };
  new Function('self', source)(self);

  async function click(action: string, data: unknown) {
    let pending: Promise<unknown> = Promise.resolve();
    const close = vi.fn();
    listeners.notificationclick!({
      action,
      notification: { data, close },
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
    return { close };
  }

  return { clients, click };
}

function fakeClient(): FakeClient {
  return { postMessage: vi.fn(), focus: vi.fn(() => Promise.resolve()) };
}

describe('sw-notifications.js', () => {
  it('«Done» with an open window posts the id to it without focusing', async () => {
    const client = fakeClient();
    const { clients, click } = loadWorker([client]);
    const { close } = await click('done', { reminderId: 'r1' });
    expect(close).toHaveBeenCalled();
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'hourtrack:reminder-done', id: 'r1' });
    expect(client.focus).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('«Done» with no window opens the app with the id in the URL', async () => {
    const { clients, click } = loadWorker([]);
    await click('done', { reminderId: 'r 1' });
    expect(clients.openWindow).toHaveBeenCalledWith('/?reminderDone=r%201');
  });

  it('a body tap focuses the open window and asks it to show the reminders', async () => {
    const client = fakeClient();
    const { clients, click } = loadWorker([client]);
    await click('', { reminderId: 'r1' });
    expect(client.focus).toHaveBeenCalled();
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'hourtrack:open-reminders' });
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('a body tap with no window opens the app on the reminders list', async () => {
    const { clients, click } = loadWorker([]);
    await click('', { reminderId: 'r1' });
    expect(clients.openWindow).toHaveBeenCalledWith('/?openReminders=1');
  });

  it('the test notification just focuses or opens the app', async () => {
    const client = fakeClient();
    const withWindow = loadWorker([client]);
    await withWindow.click('', undefined);
    expect(client.focus).toHaveBeenCalled();
    expect(client.postMessage).not.toHaveBeenCalled();

    const without = loadWorker([]);
    await without.click('', undefined);
    expect(without.clients.openWindow).toHaveBeenCalledWith('/');
  });
});
