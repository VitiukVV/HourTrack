import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installNotificationEnv, type FakeNotificationEnv } from '@/test-utils/notificationEnv';

const h = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => h.toastError(...a) } }));

import { readNotificationsEnabled, writeNotificationsEnabled } from './notificationPrefs';
import { useNotificationStatus } from './useNotificationStatus';

let env: FakeNotificationEnv | null = null;

afterEach(() => {
  env?.restore();
  env = null;
  localStorage.clear();
  h.toastError.mockReset();
  vi.restoreAllMocks();
});

describe('useNotificationStatus', () => {
  it('reports unsupported and enable() does nothing without the API', async () => {
    const { result } = renderHook(() => useNotificationStatus());
    expect(result.current.status).toBe('unsupported');
    await act(() => result.current.enable());
    expect(readNotificationsEnabled()).toBe(false);
  });

  it('enable() asks for permission when it was never asked, and turns on when granted', async () => {
    env = installNotificationEnv({ permission: 'default' });
    env.requestPermission.mockImplementation(() => {
      env!.setPermission('granted');
      return Promise.resolve('granted');
    });
    const { result } = renderHook(() => useNotificationStatus());
    expect(result.current.status).toBe('off');

    await act(() => result.current.enable());

    expect(env.requestPermission).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('on');
    expect(readNotificationsEnabled()).toBe(true);
  });

  it('enable() with permission already granted turns on without a prompt', async () => {
    env = installNotificationEnv({ permission: 'granted' });
    const { result } = renderHook(() => useNotificationStatus());
    await act(() => result.current.enable());
    expect(env.requestPermission).not.toHaveBeenCalled();
    expect(result.current.status).toBe('on');
  });

  it('a dismissed prompt leaves it off', async () => {
    env = installNotificationEnv({ permission: 'default' });
    const { result } = renderHook(() => useNotificationStatus());
    await act(() => result.current.enable());
    expect(result.current.status).toBe('off');
    expect(readNotificationsEnabled()).toBe(false);
  });

  it('a denied prompt shows blocked', async () => {
    env = installNotificationEnv({ permission: 'default' });
    env.requestPermission.mockImplementation(() => {
      env!.setPermission('denied');
      return Promise.resolve('denied');
    });
    const { result } = renderHook(() => useNotificationStatus());
    await act(() => result.current.enable());
    expect(result.current.status).toBe('blocked');
  });

  it('a throwing prompt shows an error and stays off', async () => {
    env = installNotificationEnv({ permission: 'default' });
    env.requestPermission.mockRejectedValue(new Error('nope'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useNotificationStatus());
    await act(() => result.current.enable());
    expect(result.current.status).toBe('off');
    expect(h.toastError).toHaveBeenCalledTimes(1);
  });

  it('disable() turns it off without touching the permission', () => {
    env = installNotificationEnv({ permission: 'granted' });
    writeNotificationsEnabled(true);
    const { result } = renderHook(() => useNotificationStatus());
    expect(result.current.status).toBe('on');
    act(() => result.current.disable());
    expect(result.current.status).toBe('off');
    expect(Notification.permission).toBe('granted');
  });

  it('re-reads the permission when the app comes back to the foreground', async () => {
    env = installNotificationEnv({ permission: 'granted' });
    writeNotificationsEnabled(true);
    const { result } = renderHook(() => useNotificationStatus());
    env.setPermission('denied');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(result.current.status).toBe('blocked'));
  });

  it('sendTest() posts a test notification', async () => {
    env = installNotificationEnv({ permission: 'granted' });
    writeNotificationsEnabled(true);
    const { result } = renderHook(() => useNotificationStatus());
    await act(() => result.current.sendTest());
    expect(env.registration.showNotification).toHaveBeenCalledTimes(1);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('sendTest() without a service worker shows an error', async () => {
    env = installNotificationEnv({ permission: 'granted', withRegistration: false });
    const { result } = renderHook(() => useNotificationStatus());
    await act(() => result.current.sendTest());
    expect(h.toastError).toHaveBeenCalledTimes(1);
  });

  it('sendTest() that throws shows an error', async () => {
    env = installNotificationEnv({ permission: 'granted' });
    env.registration.showNotification.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useNotificationStatus());
    await act(() => result.current.sendTest());
    expect(h.toastError).toHaveBeenCalledTimes(1);
  });
});
