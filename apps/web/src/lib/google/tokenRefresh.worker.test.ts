import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthTokens } from './tokenStore';

/**
 * S31 Task 11 (UR-31-7) — `startTokenRefresh` (the background worker loop) was
 * untested (the AuthProvider test disables it). This suite drives it with FAKE
 * TIMERS and an IN-MEMORY tokenStore mock (no fake-indexeddb — the two
 * deadlock together per the S28 journal): it schedules at `nextRefreshDelay`,
 * re-arms after a successful refresh, clears tokens + stops when both refresh
 * paths fail, and cancels the pending timer on unsubscribe.
 */

const h = vi.hoisted(() => ({
  tokens: null as AuthTokens | null,
  clearTokens: vi.fn(),
}));

vi.mock('./gisClient', () => ({
  refreshAccessToken: vi.fn(),
  silentReauth: vi.fn(),
  GisFlowError: class extends Error {},
  GisNotConfiguredError: class extends Error {},
}));

vi.mock('./tokenStore', () => ({
  getTokens: () => Promise.resolve(h.tokens),
  setTokens: (t: AuthTokens) => {
    h.tokens = { ...h.tokens, ...t } as AuthTokens;
    return Promise.resolve();
  },
  clearTokens: () => {
    h.clearTokens();
    h.tokens = null;
    return Promise.resolve();
  },
}));

import { refreshAccessToken, silentReauth } from './gisClient';
import { startTokenRefresh, nextRefreshDelay } from './tokenRefresh';

const HOUR = 60 * 60 * 1000;

function seedTokens(overrides: Partial<AuthTokens> = {}): void {
  h.tokens = {
    accessToken: 'AT-OLD',
    accessTokenExpiresAt: Date.now() + HOUR,
    scope: 'openid email profile',
    refreshToken: 'RT',
    ...overrides,
  } as AuthTokens;
}

/**
 * `navigator.onLine` is a read-only getter in happy-dom, so the offline hold
 * is driven through a redefined property that `afterEach` restores.
 */
function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000_000);
  setOnline(true);
  h.tokens = null;
  h.clearTokens.mockReset();
  vi.mocked(refreshAccessToken).mockReset();
  vi.mocked(silentReauth).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startTokenRefresh worker loop (S31 / UR-31-7)', () => {
  it('schedules the refresh at nextRefreshDelay (not before)', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    vi.mocked(refreshAccessToken).mockResolvedValue({
      access_token: 'AT-NEW',
      expires_in: 3600,
      scope: 'openid email profile',
      token_type: 'Bearer',
    });

    const expectedDelay = nextRefreshDelay(h.tokens!.accessTokenExpiresAt, Date.now());
    const stop = startTokenRefresh();
    await vi.advanceTimersByTimeAsync(0); // let schedule() register the timer

    // One millisecond before the scheduled delay → no refresh yet.
    await vi.advanceTimersByTimeAsync(expectedDelay - 1);
    expect(refreshAccessToken).not.toHaveBeenCalled();

    // Cross the threshold → refresh fires.
    await vi.advanceTimersByTimeAsync(1);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

    stop();
  });

  it('re-arms after a successful refresh', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    vi.mocked(refreshAccessToken).mockResolvedValue({
      access_token: 'AT-NEW',
      expires_in: 3600, // → new expiry one hour past the (fake) refresh moment
      scope: 'openid email profile',
      token_type: 'Bearer',
    });

    const stop = startTokenRefresh();
    await vi.advanceTimersByTimeAsync(0);

    // First refresh.
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

    // The loop re-scheduled for the fresh expiry → a second refresh fires later.
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);

    stop();
  });

  it('clears tokens + calls onAuthLost + stops only after the retry backoff is exhausted', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    const { GisFlowError } = await import('./gisClient');
    vi.mocked(refreshAccessToken).mockRejectedValue(new GisFlowError('grant failed'));
    vi.mocked(silentReauth).mockRejectedValue(new GisFlowError('silent failed'));

    const onAuthLost = vi.fn();
    const stop = startTokenRefresh({ onAuthLost });
    await vi.advanceTimersByTimeAsync(0);

    // First failure — the user stays signed in while the backoff runs.
    await vi.advanceTimersByTimeAsync(nextRefreshDelay(Date.now() + HOUR, Date.now()));
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(h.clearTokens).not.toHaveBeenCalled();

    // Retries at 30s / 2min / 5min.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
    expect(h.clearTokens).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(refreshAccessToken).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(refreshAccessToken).toHaveBeenCalledTimes(4);

    // Budget exhausted → auth is dropped.
    expect(h.clearTokens).toHaveBeenCalledTimes(1);
    expect(onAuthLost).toHaveBeenCalledTimes(1);

    // The loop stopped — no further attempts even after more time passes.
    await vi.advanceTimersByTimeAsync(HOUR * 3);
    expect(refreshAccessToken).toHaveBeenCalledTimes(4);

    stop();
  });

  it('re-arms without signing the user out when a retry succeeds', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    const { GisFlowError } = await import('./gisClient');
    vi.mocked(refreshAccessToken)
      .mockRejectedValueOnce(new GisFlowError('transient'))
      .mockResolvedValue({
        access_token: 'AT-NEW',
        expires_in: 3600,
        scope: 'openid email profile',
        token_type: 'Bearer',
      });
    vi.mocked(silentReauth).mockRejectedValue(new GisFlowError('silent failed'));

    const onAuthLost = vi.fn();
    const stop = startTokenRefresh({ onAuthLost });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(nextRefreshDelay(Date.now() + HOUR, Date.now())); // fails
    await vi.advanceTimersByTimeAsync(30_000); // first retry succeeds

    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
    expect(h.clearTokens).not.toHaveBeenCalled();
    expect(onAuthLost).not.toHaveBeenCalled();

    stop();
  });

  it('holds the session while offline instead of signing the user out', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    const { GisFlowError } = await import('./gisClient');
    vi.mocked(refreshAccessToken).mockRejectedValue(new GisFlowError('offline'));
    vi.mocked(silentReauth).mockRejectedValue(new GisFlowError('offline'));
    setOnline(false);

    const onAuthLost = vi.fn();
    const stop = startTokenRefresh({ onAuthLost });
    await vi.advanceTimersByTimeAsync(0);

    // Hours offline: no renewal attempted, tokens kept, user never bounced
    // to /login — the PWA stays usable against local Dexie data.
    await vi.advanceTimersByTimeAsync(HOUR * 4);
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(silentReauth).not.toHaveBeenCalled();
    expect(h.clearTokens).not.toHaveBeenCalled();
    expect(onAuthLost).not.toHaveBeenCalled();

    // Connectivity returns → the loop resumes on the next re-check.
    setOnline(true);
    vi.mocked(refreshAccessToken).mockResolvedValue({
      access_token: 'AT-NEW',
      expires_in: 3600,
      scope: 'openid email profile',
      token_type: 'Bearer',
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(h.clearTokens).not.toHaveBeenCalled();

    stop();
  });

  it('unsubscribe cancels the pending timer (no refresh after dispose)', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    vi.mocked(refreshAccessToken).mockResolvedValue({
      access_token: 'AT-NEW',
      expires_in: 3600,
      scope: 'openid email profile',
      token_type: 'Bearer',
    });

    const stop = startTokenRefresh();
    await vi.advanceTimersByTimeAsync(0);

    // Dispose BEFORE the timer fires.
    stop();
    await vi.advanceTimersByTimeAsync(HOUR * 2);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});
