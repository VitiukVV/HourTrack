import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Reminder } from '@/shared/types';
import { installNotificationEnv, type FakeNotificationEnv } from '@/test-utils/notificationEnv';

const h = vi.hoisted(() => ({
  reminders: new Map<string, Partial<Reminder>>(),
  doneMutate: vi.fn(),
  toastError: vi.fn(),
  getReminderById: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {},
  getReminderById: (...args: unknown[]) => h.getReminderById(...args),
}));
vi.mock('./useReminders', () => ({
  useMarkReminderDoneMutation: () => ({ mutate: h.doneMutate }),
}));
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => h.toastError(...a) } }));

import { NotificationBridge } from './NotificationBridge';
import { useReminderBellStore } from './useReminderBellStore';

let env: FakeNotificationEnv | null = null;
let location = '';

function LocationProbe() {
  const loc = useLocation();
  location = loc.pathname + loc.search;
  return null;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <NotificationBridge />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** The `message` listener the bridge registered on `navigator.serviceWorker`. */
function swMessageListener(): (event: { data: unknown; ports?: unknown[] }) => void {
  const add = navigator.serviceWorker.addEventListener as ReturnType<typeof vi.fn>;
  const call = add.mock.calls.find(([type]) => type === 'message');
  const listener = call![1] as (event: { data: unknown; ports: unknown[] }) => void;
  return (event) => listener({ ports: [], ...event });
}

beforeEach(() => {
  h.reminders.clear();
  h.reminders.set('open', { id: 'open', doneAt: null });
  h.reminders.set('closed', { id: 'closed', doneAt: '2026-10-20T10:00:00.000Z' });
  h.getReminderById
    .mockReset()
    .mockImplementation((_db: unknown, id: string) => Promise.resolve(h.reminders.get(id)));
  h.doneMutate.mockReset();
  h.toastError.mockReset();
  useReminderBellStore.setState({ open: false });
});

afterEach(() => {
  env?.restore();
  env = null;
  vi.restoreAllMocks();
});

describe('NotificationBridge — service worker messages', () => {
  beforeEach(() => {
    env = installNotificationEnv({ permission: 'granted' });
  });

  it('«Done» marks an open reminder done', async () => {
    renderAt('/');
    act(() => swMessageListener()({ data: { type: 'hourtrack:reminder-done', id: 'open' } }));
    await waitFor(() => expect(h.doneMutate).toHaveBeenCalledWith('open'));
  });

  it('acks «Done» on the transferred port so the SW does not re-show it', () => {
    const port = { postMessage: vi.fn() };
    renderAt('/');
    act(() =>
      swMessageListener()({ data: { type: 'hourtrack:reminder-done', id: 'open' }, ports: [port] }),
    );
    expect(port.postMessage).toHaveBeenCalledWith({ ok: true });
  });

  it('completes a reminder once even if the tap arrives twice', async () => {
    renderAt('/?reminderDone=open');
    act(() => swMessageListener()({ data: { type: 'hourtrack:reminder-done', id: 'open' } }));
    await waitFor(() => expect(h.doneMutate).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(h.doneMutate).toHaveBeenCalledTimes(1);
  });

  it('«Done» for a missing or already-done reminder does nothing', async () => {
    renderAt('/');
    act(() => {
      swMessageListener()({ data: { type: 'hourtrack:reminder-done', id: 'closed' } });
      swMessageListener()({ data: { type: 'hourtrack:reminder-done', id: 'nope' } });
    });
    await waitFor(() => expect(h.getReminderById).toHaveBeenCalledTimes(2));
    expect(h.doneMutate).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('a failed lookup reports the error instead of swallowing it', async () => {
    h.getReminderById.mockRejectedValue(new Error('db closed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAt('/');
    act(() => swMessageListener()({ data: { type: 'hourtrack:reminder-done', id: 'open' } }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
  });

  it('a body tap opens the reminders list', () => {
    renderAt('/');
    act(() => swMessageListener()({ data: { type: 'hourtrack:open-reminders' } }));
    expect(useReminderBellStore.getState().open).toBe(true);
  });

  it('ignores unrelated messages', () => {
    renderAt('/');
    act(() => swMessageListener()({ data: { type: 'workbox:whatever' } }));
    act(() => swMessageListener()({ data: null }));
    expect(useReminderBellStore.getState().open).toBe(false);
    expect(h.getReminderById).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount', () => {
    const { unmount } = renderAt('/');
    const add = navigator.serviceWorker.addEventListener as ReturnType<typeof vi.fn>;
    const listener = add.mock.calls.find(([type]) => type === 'message')![1];
    unmount();
    expect(navigator.serviceWorker.removeEventListener).toHaveBeenCalledWith('message', listener);
  });
});

describe('NotificationBridge — launch URL (app was closed)', () => {
  it('?reminderDone marks the reminder done and strips the param', async () => {
    renderAt('/day?x=1&reminderDone=open');
    await waitFor(() => expect(h.doneMutate).toHaveBeenCalledWith('open'));
    expect(location).toBe('/day?x=1');
  });

  it('?openReminders opens the list and strips the param', async () => {
    renderAt('/?openReminders=1');
    await waitFor(() => expect(useReminderBellStore.getState().open).toBe(true));
    expect(location).toBe('/');
  });

  it('?reminderDone for an already-done reminder does nothing but still strips the param', async () => {
    renderAt('/?reminderDone=closed');
    await waitFor(() => expect(location).toBe('/'));
    await waitFor(() => expect(h.getReminderById).toHaveBeenCalled());
    expect(h.doneMutate).not.toHaveBeenCalled();
  });

  it('the URL path works without service worker support', async () => {
    renderAt('/?openReminders=1');
    await waitFor(() => expect(useReminderBellStore.getState().open).toBe(true));
  });
});
