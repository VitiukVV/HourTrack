import { afterEach, describe, expect, it, vi } from 'vitest';

import source from '../../../public/sw-notifications.js?raw';
import viteConfig from '../../../vite.config.ts?raw';

/**
 * Spec 013 — `public/sw-notifications.js` runs inside the generated Workbox
 * service worker, outside the bundle. The test evaluates its source against a
 * fake `self` and fires `notificationclick` at it.
 */

interface FakeClient {
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

const NOTIFICATION = {
  title: 'Reminder',
  body: 'Call Mary',
  tag: 'reminder:r1',
  icon: '/icons/pwa-192x192.png',
  actions: [{ action: 'done', title: 'Done' }],
};

function loadWorker(windows: FakeClient[], opts: { openWindowResult?: unknown } = {}) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const clients = {
    matchAll: vi.fn(() => Promise.resolve(windows)),
    openWindow: vi.fn(() =>
      Promise.resolve('openWindowResult' in opts ? opts.openWindowResult : {}),
    ),
  };
  const registration = { showNotification: vi.fn(() => Promise.resolve()) };
  const self = {
    clients,
    registration,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
  };
  new Function('self', source)(self);

  function click(action: string, data: unknown) {
    let pending: Promise<unknown> = Promise.resolve();
    const close = vi.fn();
    listeners.notificationclick!({
      action,
      notification: { ...NOTIFICATION, data, close },
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    return { close, done: pending };
  }

  return { clients, registration, click };
}

/** A window running `NotificationBridge`: it acks every message that carries a port. */
function ackingClient(): FakeClient {
  return {
    postMessage: vi.fn((_msg: unknown, ports?: MessagePort[]) =>
      ports?.[0]?.postMessage({ ok: true }),
    ),
    focus: vi.fn(() => Promise.resolve()),
  };
}

/** A window that never answers (sign-in screen, frozen tab). */
function silentClient(): FakeClient {
  return { postMessage: vi.fn(), focus: vi.fn(() => Promise.resolve()) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sw-notifications.js', () => {
  it('is wired into the generated service worker', () => {
    expect(viteConfig).toMatch(/importScripts:\s*\['sw-notifications\.js'\]/);
  });

  it('«Done» with a confirming window posts the id to it without focusing', async () => {
    const client = ackingClient();
    const { clients, registration, click } = loadWorker([client]);
    const { close, done } = click('done', { reminderId: 'r1' });
    await done;
    expect(close).toHaveBeenCalled();
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'hourtrack:reminder-done', id: 'r1' }, [
      expect.anything(),
    ]);
    expect(client.focus).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
    expect(registration.showNotification).not.toHaveBeenCalled();
  });

  it('«Done» to a window that does not confirm brings the notification back', async () => {
    vi.useFakeTimers();
    const { registration, click } = loadWorker([silentClient()]);
    const { done } = click('done', { reminderId: 'r1' });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(registration.showNotification).toHaveBeenCalledWith(
      'Reminder',
      expect.objectContaining({
        body: 'Call Mary',
        tag: 'reminder:r1',
        data: { reminderId: 'r1' },
        actions: NOTIFICATION.actions,
      }),
    );
  });

  it('«Done» with no window opens the app with the id in the URL', async () => {
    const { clients, registration, click } = loadWorker([]);
    await click('done', { reminderId: 'r 1' }).done;
    expect(clients.openWindow).toHaveBeenCalledWith('/?reminderDone=r%201');
    expect(registration.showNotification).not.toHaveBeenCalled();
  });

  it('«Done» brings the notification back when no window may be opened', async () => {
    const { registration, click } = loadWorker([], { openWindowResult: null });
    await click('done', { reminderId: 'r1' }).done;
    expect(registration.showNotification).toHaveBeenCalledTimes(1);
  });

  it('a body tap focuses the open window and asks it to show the reminders', async () => {
    const client = silentClient();
    const { clients, click } = loadWorker([client]);
    await click('', { reminderId: 'r1' }).done;
    expect(client.focus).toHaveBeenCalled();
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'hourtrack:open-reminders' });
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('a body tap with no window opens the app on the reminders list', async () => {
    const { clients, click } = loadWorker([]);
    await click('', { reminderId: 'r1' }).done;
    expect(clients.openWindow).toHaveBeenCalledWith('/?openReminders=1');
  });

  it('the test notification just focuses or opens the app', async () => {
    const client = silentClient();
    const withWindow = loadWorker([client]);
    await withWindow.click('', undefined).done;
    expect(client.focus).toHaveBeenCalled();
    expect(client.postMessage).not.toHaveBeenCalled();

    const without = loadWorker([]);
    await without.click('', undefined).done;
    expect(without.clients.openWindow).toHaveBeenCalledWith('/');
  });

  it('a failing click is logged, not left as an unhandled rejection', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { clients, click } = loadWorker([]);
    clients.openWindow.mockRejectedValue(new Error('not allowed'));
    await click('', { reminderId: 'r1' }).done;
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
