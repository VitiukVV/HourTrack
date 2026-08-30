import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthTokens } from './tokenStore';

/**
 * S31 Task 11 (UR-31-7) — `startTokenRefresh` (the background worker loop) was
 * untested (the AuthProvider test disables it). This suite drives it with FAKE
 * TIMERS and an IN-MEMORY tokenStore mock (no fake-indexeddb — the two
 * deadlock together per the S28 journal): it schedules at `nextRefreshDelay`,
 * re-arms after a successful refresh, retries transient failures forever,
 * ends the session only on a real refusal, holds while offline or hidden, and
 * cancels the pending timer on unsubscribe.
 */

const h = vi.hoisted(() => ({
  tokens: null as AuthTokens | null,
  clearTokens: vi.fn(),
}));

vi.mock('./gisClient', () => ({
  refreshAccessToken: vi.fn(),
  silentReauth: vi.fn(),
  getUserInfo: vi.fn(),
  normalizeExpiresIn: (raw: unknown) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 3600;
  },
  GisFlowError: class extends Error {
    readonly code?: string;
    constructor(message: string, code?: string) {
      super(message);
      this.name = 'GisFlowError';
      this.code = code;
    }
  },
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

import { refreshAccessToken, silentReauth, GisFlowError } from './gisClient';
import { startTokenRefresh, nextRefreshDelay } from './tokenRefresh';

const HOUR = 60 * 60 * 1000;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FULL_SCOPE = `openid email profile ${DRIVE_SCOPE}`;

function seedTokens(overrides: Partial<AuthTokens> = {}): void {
  h.tokens = {
    accessToken: 'AT-OLD',
    accessTokenExpiresAt: Date.now() + HOUR,
    scope: FULL_SCOPE,
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

/** Same trick for `document.visibilityState`, plus the event the loop listens to. */
function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000_000);
  setOnline(true);
  setVisibility('visible');
  h.tokens = null;
  h.clearTokens.mockReset();
  vi.mocked(refreshAccessToken).mockReset();
  vi.mocked(silentReauth).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockRefreshOk(accessToken = 'AT-NEW'): void {
  vi.mocked(refreshAccessToken).mockResolvedValue({
    access_token: accessToken,
    expires_in: 3600,
    scope: FULL_SCOPE,
    token_type: 'Bearer',
  });
}

describe('startTokenRefresh worker loop (S31 / UR-31-7)', () => {
  it('schedules the refresh at nextRefreshDelay (not before)', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    mockRefreshOk();

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
    mockRefreshOk(); // → new expiry one hour past the (fake) refresh moment

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

  it('ends the session as soon as Google actually refuses the renewal', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    vi.mocked(refreshAccessToken).mockRejectedValue(new GisFlowError('grant failed'));
    vi.mocked(silentReauth).mockRejectedValue(new GisFlowError('interaction_required'));

    const onAuthLost = vi.fn();
    const stop = startTokenRefresh({ onAuthLost });
    await vi.advanceTimersByTimeAsync(0);

    // No retry budget to burn: a codeless GIS refusal under `prompt: 'none'`
    // means interaction is required, and no amount of waiting fixes that.
    await vi.advanceTimersByTimeAsync(nextRefreshDelay(Date.now() + HOUR, Date.now()));
    expect(h.clearTokens).toHaveBeenCalledTimes(1);
    expect(onAuthLost).toHaveBeenCalledTimes(1);

    // The loop stopped — no further attempts even after more time passes.
    await vi.advanceTimersByTimeAsync(HOUR * 3);
    expect(silentReauth).toHaveBeenCalledTimes(1);

    stop();
  });

  it('retries a transient failure indefinitely instead of signing the user out', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    vi.mocked(refreshAccessToken).mockRejectedValue(new GisFlowError('5xx'));
    // A popup the browser blocked — the classic background-tab outcome.
    vi.mocked(silentReauth).mockRejectedValue(new GisFlowError('blocked', 'popup_failed_to_open'));

    const onAuthLost = vi.fn();
    const stop = startTokenRefresh({ onAuthLost });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(nextRefreshDelay(Date.now() + HOUR, Date.now()));
    expect(silentReauth).toHaveBeenCalledTimes(1);

    // Backoff 30s → 2min → 5min, then 5min forever.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(silentReauth).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(silentReauth).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(silentReauth).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(silentReauth).toHaveBeenCalledTimes(5);

    // Hours of failures later the user is still signed in with local data.
    await vi.advanceTimersByTimeAsync(HOUR * 2);
    expect(h.clearTokens).not.toHaveBeenCalled();
    expect(onAuthLost).not.toHaveBeenCalled();
    expect(h.tokens).not.toBeNull();

    stop();
  });

  it('re-arms without signing the user out when a retry succeeds', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    vi.mocked(refreshAccessToken)
      .mockRejectedValueOnce(new GisFlowError('transient'))
      .mockResolvedValue({
        access_token: 'AT-NEW',
        expires_in: 3600,
        scope: FULL_SCOPE,
        token_type: 'Bearer',
      });
    vi.mocked(silentReauth).mockRejectedValue(new GisFlowError('blocked', 'popup_closed'));

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
    mockRefreshOk();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(h.clearTokens).not.toHaveBeenCalled();

    stop();
  });

  it('defers the renewal while the tab is hidden and runs it on return', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    mockRefreshOk();
    setVisibility('hidden');

    const stop = startTokenRefresh();
    await vi.advanceTimersByTimeAsync(0);

    // GIS opens a real window even for `prompt: 'none'`; firing it here would
    // flash a Google popup over whatever the user is actually looking at.
    await vi.advanceTimersByTimeAsync(HOUR * 3);
    expect(refreshAccessToken).not.toHaveBeenCalled();

    // Deferred, not dropped: the tab coming back runs it immediately.
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

    stop();
  });

  it('unsubscribe cancels the pending timer (no refresh after dispose)', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    mockRefreshOk();

    const stop = startTokenRefresh();
    await vi.advanceTimersByTimeAsync(0);

    // Dispose BEFORE the timer fires.
    stop();
    await vi.advanceTimersByTimeAsync(HOUR * 2);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('unsubscribe cancels a pending visibility deferral too', async () => {
    seedTokens({ accessTokenExpiresAt: Date.now() + HOUR });
    mockRefreshOk();
    setVisibility('hidden');

    const stop = startTokenRefresh();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(HOUR); // tick lands, defers
    stop();

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});
