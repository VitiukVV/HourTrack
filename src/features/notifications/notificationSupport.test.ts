import { afterEach, describe, expect, it } from 'vitest';

import { installNotificationEnv, type FakeNotificationEnv } from '@/test-utils/notificationEnv';

import { getNotificationStatus, getSwRegistration } from './notificationSupport';

let env: FakeNotificationEnv | null = null;

afterEach(() => {
  env?.restore();
  env = null;
});

describe('getNotificationStatus', () => {
  it('is unsupported without the Notification API', () => {
    expect(getNotificationStatus(true)).toBe('unsupported');
  });

  it.each([
    ['default', false, 'off'],
    ['default', true, 'off'],
    ['granted', false, 'off'],
    ['granted', true, 'on'],
    ['denied', false, 'blocked'],
    ['denied', true, 'blocked'],
  ] as const)('permission %s + pref %s → %s', (permission, enabled, expected) => {
    env = installNotificationEnv({ permission });
    expect(getNotificationStatus(enabled)).toBe(expected);
  });
});

describe('getSwRegistration', () => {
  it('returns the registration when the service worker is registered', async () => {
    env = installNotificationEnv();
    expect(await getSwRegistration()).toBe(env.registration);
  });

  it('returns undefined when no service worker is registered (dev)', async () => {
    env = installNotificationEnv({ withRegistration: false });
    expect(await getSwRegistration()).toBeUndefined();
  });

  it('returns undefined when the API is missing', async () => {
    expect(await getSwRegistration()).toBeUndefined();
  });
});
