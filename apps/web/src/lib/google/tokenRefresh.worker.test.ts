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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000_000);
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

  it('clears tokens + calls onAuthLost + stops when refresh AND silent re-auth both fail', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    const { GisFlowError } = await import('./gisClient');
    vi.mocked(refreshAccessToken).mockRejectedValue(new GisFlowError('grant failed'));
    vi.mocked(silentReauth).mockRejectedValue(new GisFlowError('silent failed'));

    const onAuthLost = vi.fn();
    const stop = startTokenRefresh({ onAuthLost });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(h.clearTokens).toHaveBeenCalledTimes(1);
    expect(onAuthLost).toHaveBeenCalledTimes(1);

    // The loop stopped — no further attempts even after more time passes.
    await vi.advanceTimersByTimeAsync(HOUR * 3);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

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
