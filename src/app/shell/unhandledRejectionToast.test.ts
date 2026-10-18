import { afterEach, describe, expect, it, vi } from 'vitest';

import { installUnhandledRejectionToast } from './unhandledRejectionToast';

/**
 * Spec 007 (FR-004) — the last safety net: a rejection nothing handled is
 * logged and told to the user, instead of living only in the console.
 */

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (msg: string) => toastError(msg) } }));

function reject(reason: unknown): void {
  const event = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent;
  Object.defineProperty(event, 'reason', { value: reason });
  window.dispatchEvent(event);
}

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  vi.restoreAllMocks();
  toastError.mockClear();
});

describe('installUnhandledRejectionToast', () => {
  it('logs and toasts an unhandled rejection', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    uninstall = installUnhandledRejectionToast();

    reject(new Error('disk full'));

    expect(log).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('ignores an aborted operation — cancelling is not a failure', () => {
    uninstall = installUnhandledRejectionToast();

    reject(new DOMException('aborted', 'AbortError'));

    expect(toastError).not.toHaveBeenCalled();
  });

  it('stops listening once uninstalled', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installUnhandledRejectionToast()();

    reject(new Error('late'));

    expect(toastError).not.toHaveBeenCalled();
  });

  it('shows a burst of the same failure once, and again after the window', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let clock = 0;
    uninstall = installUnhandledRejectionToast(() => clock);

    reject(new Error('DatabaseClosedError'));
    reject(new Error('DatabaseClosedError'));
    clock = 6000;
    reject(new Error('DatabaseClosedError'));

    expect(toastError).toHaveBeenCalledTimes(2);
  });
});
