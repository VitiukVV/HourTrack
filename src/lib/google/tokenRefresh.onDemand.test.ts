import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTokens, setTokens } from './tokenStore';
import { getFreshAccessToken, renewAccessToken } from './tokenRefresh';
import { db } from '@/lib/db';

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

const FULL_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.appdata';

function granted(token: string) {
  return { access_token: token, expires_in: 3600, scope: FULL_SCOPE, token_type: 'Bearer' };
}

beforeEach(async () => {
  await db.authTokens.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('renewAccessToken', () => {
  it('shares one renewal between concurrent callers', async () => {
    const { refreshAccessToken } = await import('./gisClient');
    let release!: () => void;
    const spy = vi.mocked(refreshAccessToken).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(granted('AT-NEW'));
        }),
    );
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      refreshToken: 'RT',
    });

    const a = renewAccessToken();
    const b = renewAccessToken();
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    release();

    expect(await a).toBe('refreshed');
    expect(await b).toBe('refreshed');
    expect(spy).toHaveBeenCalledTimes(1);

    // A later call starts a fresh renewal rather than reusing the settled one.
    spy.mockResolvedValue(granted('AT-NEWER'));
    expect(await renewAccessToken()).toBe('refreshed');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('skips the silent re-auth pop-up when told not to open one', async () => {
    const { refreshAccessToken, silentReauth, GisFlowError } = await import('./gisClient');
    vi.mocked(refreshAccessToken).mockRejectedValue(new GisFlowError('grant failed'));
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      refreshToken: 'RT-BAD',
    });

    expect(await renewAccessToken({ allowSilentReauth: false })).toBe('transient');
    expect(silentReauth).not.toHaveBeenCalled();
    expect((await getTokens())?.accessToken).toBe('AT-OLD');
  });

  it('never signs the user out, even when Google refuses', async () => {
    const { refreshAccessToken, silentReauth, GisFlowError } = await import('./gisClient');
    vi.mocked(refreshAccessToken).mockRejectedValue(new GisFlowError('grant failed'));
    vi.mocked(silentReauth).mockRejectedValue(new GisFlowError('interaction_required'));
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      refreshToken: 'RT-BAD',
    });

    expect(await renewAccessToken()).toBe('auth-lost');
    // Sign-out stays the timer loop's decision.
    expect((await getTokens())?.accessToken).toBe('AT-OLD');
  });
});

describe('getFreshAccessToken', () => {
  it('returns the stored token while it is valid beyond the margin', async () => {
    const { refreshAccessToken } = await import('./gisClient');
    await setTokens({
      accessToken: 'AT-VALID',
      accessTokenExpiresAt: Date.now() + 10 * 60_000,
      scope: FULL_SCOPE,
      refreshToken: 'RT',
    });

    expect(await getFreshAccessToken()).toBe('AT-VALID');
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('renews a token that expires within the margin', async () => {
    const { refreshAccessToken } = await import('./gisClient');
    vi.mocked(refreshAccessToken).mockResolvedValue(granted('AT-RENEWED'));
    await setTokens({
      accessToken: 'AT-EXPIRING',
      accessTokenExpiresAt: Date.now() + 30_000,
      scope: FULL_SCOPE,
      refreshToken: 'RT',
    });

    expect(await getFreshAccessToken()).toBe('AT-RENEWED');
  });

  it('falls back to the stored token when renewal fails', async () => {
    const { refreshAccessToken, GisFlowError } = await import('./gisClient');
    vi.mocked(refreshAccessToken).mockRejectedValue(new GisFlowError('grant failed'));
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    await setTokens({
      accessToken: 'AT-STALE',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      refreshToken: 'RT',
    });

    expect(await getFreshAccessToken()).toBe('AT-STALE');
  });

  it('does not open the silent re-auth pop-up from a hidden tab', async () => {
    const { silentReauth } = await import('./gisClient');
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    await setTokens({
      accessToken: 'AT-STALE',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      // no refresh token → only the pop-up path could renew
    });

    expect(await getFreshAccessToken()).toBe('AT-STALE');
    expect(silentReauth).not.toHaveBeenCalled();
  });

  it('returns null when signed out', async () => {
    expect(await getFreshAccessToken()).toBeNull();
  });
});
