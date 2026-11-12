import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkForUpdate, setServiceWorkerRegistration } from './checkForUpdate';

afterEach(() => {
  setServiceWorkerRegistration(undefined);
  vi.restoreAllMocks();
});

describe('checkForUpdate', () => {
  it('is a no-op without a service-worker registration', () => {
    expect(() => checkForUpdate()).not.toThrow();
  });

  it('asks the registration to check for a new build', () => {
    const update = vi.fn(() => Promise.resolve());
    setServiceWorkerRegistration({ update } as unknown as ServiceWorkerRegistration);
    checkForUpdate();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('logs a failed check instead of rejecting', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const update = vi.fn(() => Promise.reject(new Error('offline')));
    setServiceWorkerRegistration({ update } as unknown as ServiceWorkerRegistration);
    checkForUpdate();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });
});
