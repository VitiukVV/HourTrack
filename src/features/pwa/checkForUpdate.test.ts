import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  _resetCheckForUpdateForTesting,
  applyUpdateOrReload,
  checkForUpdate,
  setServiceWorkerRegistration,
} from './checkForUpdate';
import { usePwaUpdate } from './usePwaUpdate';

afterEach(() => {
  _resetCheckForUpdateForTesting();
  usePwaUpdate.setState({ waiting: false, apply: () => {} });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('checkForUpdate', () => {
  it('does not throw without a service-worker registration', () => {
    expect(() => checkForUpdate()).not.toThrow();
  });

  it('asks the registration to check for a new build', () => {
    const update = vi.fn(() => Promise.resolve());
    setServiceWorkerRegistration({ update } as unknown as ServiceWorkerRegistration);
    checkForUpdate();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('runs a check asked for before the registration arrived, once', () => {
    checkForUpdate();
    checkForUpdate();
    const update = vi.fn(() => Promise.resolve());
    setServiceWorkerRegistration({ update } as unknown as ServiceWorkerRegistration);
    expect(update).toHaveBeenCalledTimes(1);
    setServiceWorkerRegistration({ update } as unknown as ServiceWorkerRegistration);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does not check on registration when nothing was asked for', () => {
    const update = vi.fn(() => Promise.resolve());
    setServiceWorkerRegistration({ update } as unknown as ServiceWorkerRegistration);
    expect(update).not.toHaveBeenCalled();
  });

  it('logs a failed check instead of rejecting', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const update = vi.fn(() => Promise.reject(new Error('offline')));
    setServiceWorkerRegistration({ update } as unknown as ServiceWorkerRegistration);
    checkForUpdate();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });
});

describe('applyUpdateOrReload', () => {
  it('activates a waiting build', () => {
    const apply = vi.fn();
    usePwaUpdate.getState().markWaiting(apply);
    applyUpdateOrReload();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('reloads when no build is waiting', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    applyUpdateOrReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
