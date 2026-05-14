import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTokens, getTokens, setTokens } from './tokenStore';
import { nextRefreshDelay, performRefresh } from './tokenRefresh';
import { db } from '@/lib/db';

vi.mock('./gisClient', () => ({
  refreshAccessToken: vi.fn(),
  signIn: vi.fn(),
  GisFlowError: class extends Error {},
  GisNotConfiguredError: class extends Error {},
}));

beforeEach(async () => {
  await db.authTokens.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('nextRefreshDelay', () => {
  it('returns expiresAt - 5min - now when far in the future', () => {
    const now = 1_000_000;
    const expires = now + 60 * 60 * 1000; // 1 hour out
    const delay = nextRefreshDelay(expires, now);
    expect(delay).toBe(60 * 60 * 1000 - 5 * 60 * 1000);
  });

  it('clamps to MIN_DELAY_MS when already expired', () => {
    const now = 2_000_000;
    const expires = 1_000_000; // already gone
    const delay = nextRefreshDelay(expires, now);
    expect(delay).toBe(1000);
  });

  it('clamps to MIN_DELAY_MS when within the 5-minute lead window', () => {
    const now = 1_000_000;
    const expires = now + 1000; // 1 second out
    const delay = nextRefreshDelay(expires, now);
    expect(delay).toBe(1000);
  });
});

describe('performRefresh', () => {
  it('returns false when no tokens are present', async () => {
    expect(await performRefresh()).toBe(false);
  });

  it('uses the refresh_token grant when a refresh token is present', async () => {
    const { refreshAccessToken } = await import('./gisClient');
    const spy = vi.mocked(refreshAccessToken).mockResolvedValue({
      access_token: 'AT-NEW',
      expires_in: 3600,
      scope: 'openid email profile',
      token_type: 'Bearer',
    });
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: 'openid email profile',
      refreshToken: 'RT',
    });
    const ok = await performRefresh();
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('RT');
    const after = await getTokens();
    expect(after?.accessToken).toBe('AT-NEW');
    // refreshToken carried forward when not provided in response
    expect(after?.refreshToken).toBe('RT');
  });

  it('falls back to silent re-auth when refresh_token grant fails', async () => {
    const { refreshAccessToken, signIn, GisFlowError } = await import('./gisClient');
    vi.mocked(refreshAccessToken).mockRejectedValue(new GisFlowError('grant failed'));
    const signInSpy = vi.mocked(signIn).mockResolvedValue({
      access_token: 'AT-SILENT',
      expires_in: 3600,
      scope: 'openid email profile',
      token_type: 'Bearer',
    });
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: 'openid email profile',
      refreshToken: 'RT-BAD',
      email: 'cached@example.com',
    });
    const ok = await performRefresh();
    expect(ok).toBe(true);
    expect(signInSpy).toHaveBeenCalledWith({ prompt: 'none', hint: 'cached@example.com' });
    const after = await getTokens();
    expect(after?.accessToken).toBe('AT-SILENT');
  });

  it('uses silent re-auth directly when no refresh token exists', async () => {
    const { signIn } = await import('./gisClient');
    const signInSpy = vi.mocked(signIn).mockResolvedValue({
      access_token: 'AT-SILENT-2',
      expires_in: 3600,
      scope: 'openid email profile',
      token_type: 'Bearer',
    });
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: 'openid email profile',
      // no refreshToken
    });
    const ok = await performRefresh();
    expect(ok).toBe(true);
    expect(signInSpy).toHaveBeenCalledWith({ prompt: 'none', hint: undefined });
  });

  it('returns false when both paths fail', async () => {
    const { refreshAccessToken, signIn, GisFlowError } = await import('./gisClient');
    vi.mocked(refreshAccessToken).mockRejectedValue(new GisFlowError('grant failed'));
    vi.mocked(signIn).mockRejectedValue(new GisFlowError('silent failed'));
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: 'openid email profile',
      refreshToken: 'RT-BAD',
    });
    const ok = await performRefresh();
    expect(ok).toBe(false);
    // tokens still present (worker clears them, not performRefresh)
    const after = await getTokens();
    expect(after?.accessToken).toBe('AT-OLD');
    await clearTokens();
  });
});
