import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NOTIFICATIONS_ENABLED_STORAGE_KEY,
  readNotificationsEnabled,
  writeNotificationsEnabled,
} from './notificationPrefs';

/** A `localStorage` whose writes throw (quota / blocked site data). */
function stubThrowingStorage(reads: 'work' | 'throw' = 'work') {
  const real = localStorage;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => {
      if (reads === 'throw') throw new Error('blocked');
      return real.getItem(key);
    },
    setItem: () => {
      throw new Error('quota');
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('notification preference (per device)', () => {
  it('defaults to off', () => {
    expect(readNotificationsEnabled()).toBe(false);
  });

  it('round-trips on and off through localStorage', () => {
    expect(writeNotificationsEnabled(true)).toBe(true);
    expect(localStorage.getItem(NOTIFICATIONS_ENABLED_STORAGE_KEY)).toBe('1');
    expect(readNotificationsEnabled()).toBe(true);
    writeNotificationsEnabled(false);
    expect(readNotificationsEnabled()).toBe(false);
  });

  it('reads as off and writes without throwing when storage is unavailable', () => {
    stubThrowingStorage('throw');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readNotificationsEnabled()).toBe(false);
    expect(writeNotificationsEnabled(true)).toBe(false);
  });
});
