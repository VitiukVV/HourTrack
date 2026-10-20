import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NOTIFICATIONS_ENABLED_STORAGE_KEY,
  readNotificationsEnabled,
  writeNotificationsEnabled,
} from './notificationPrefs';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('notification preference (per device)', () => {
  it('defaults to off', () => {
    expect(readNotificationsEnabled()).toBe(false);
  });

  it('round-trips on and off through localStorage', () => {
    writeNotificationsEnabled(true);
    expect(localStorage.getItem(NOTIFICATIONS_ENABLED_STORAGE_KEY)).toBe('1');
    expect(readNotificationsEnabled()).toBe(true);
    writeNotificationsEnabled(false);
    expect(readNotificationsEnabled()).toBe(false);
  });

  it('reads as off and writes without throwing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readNotificationsEnabled()).toBe(false);
    expect(() => writeNotificationsEnabled(true)).not.toThrow();
  });
});
