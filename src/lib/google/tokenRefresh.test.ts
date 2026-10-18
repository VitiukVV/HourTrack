import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTokens, getTokens, setTokens } from './tokenStore';
import { classifyRefreshError, nextRefreshDelay, performRefresh } from './tokenRefresh';
import { db } from '@/lib/db';

vi.mock('./gisClient', () => ({
  refreshAccessToken: vi.fn(),
  silentReauth: vi.fn(),
  getUserInfo: vi.fn(),
  normalizeExpiresIn: (raw: unknown) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 3600;
  },
  // Mirrors the real class closely enough for `instanceof` + `.code`, which is
  // what the outcome classification keys on.
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

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FULL_SCOPE = `openid email profile ${DRIVE_SCOPE}`;

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

describe('classifyRefreshError', () => {
  it('treats a blocked or closed popup as transient', async () => {
    const { GisFlowError } = await import('./gisClient');
    expect(classifyRefreshError(new GisFlowError('blocked', 'popup_failed_to_open'))).toBe(
      'transient',
    );
    expect(classifyRefreshError(new GisFlowError('closed', 'popup_closed'))).toBe('transient');
  });

  it('treats a codeless GIS refusal as auth loss', async () => {
    const { GisFlowError } = await import('./gisClient');
    // `prompt: 'none'` failing without a popup code means interaction is
    // required — the silent grant is gone.
    expect(classifyRefreshError(new GisFlowError('interaction_required'))).toBe('auth-lost');
  });

  it('treats an unrecognised error as transient', () => {
    // A TypeError from a failed fetch must never cost the user their session.
    expect(classifyRefreshError(new TypeError('Failed to fetch'))).toBe('transient');
    expect(classifyRefreshError('nonsense')).toBe('transient');
  });
});

describe('performRefresh', () => {
  it('reports transient (not auth loss) when no tokens are present', async () => {
    expect(await performRefresh()).toBe('transient');
  });

  it('uses the refresh_token grant when a refresh token is present', async () => {
    const { refreshAccessToken } = await import('./gisClient');
    const spy = vi.mocked(refreshAccessToken).mockResolvedValue({
      access_token: 'AT-NEW',
      expires_in: 3600,
      scope: FULL_SCOPE,
      token_type: 'Bearer',
    });
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      refreshToken: 'RT',
    });
    expect(await performRefresh()).toBe('refreshed');
    expect(spy).toHaveBeenCalledWith('RT');
    const after = await getTokens();
    expect(after?.accessToken).toBe('AT-NEW');
    // refreshToken carried forward when not provided in response
    expect(after?.refreshToken).toBe('RT');
  });

  it('falls back to silent re-auth when refresh_token grant fails', async () => {
    const { refreshAccessToken, silentReauth, getUserInfo, GisFlowError } =
      await import('./gisClient');
    vi.mocked(refreshAccessToken).mockRejectedValue(new GisFlowError('grant failed'));
    const silentSpy = vi.mocked(silentReauth).mockResolvedValue({
      access_token: 'AT-SILENT',
      expires_in: 3600,
      scope: FULL_SCOPE,
      token_type: 'Bearer',
    });
    vi.mocked(getUserInfo).mockResolvedValue({ sub: '1', email: 'cached@example.com' });
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      refreshToken: 'RT-BAD',
      email: 'cached@example.com',
    });
    expect(await performRefresh()).toBe('refreshed');
    expect(silentSpy).toHaveBeenCalledWith('cached@example.com');
    const after = await getTokens();
    expect(after?.accessToken).toBe('AT-SILENT');
    // refresh_token carried forward (silentReauth never returns one)
    expect(after?.refreshToken).toBe('RT-BAD');
  });

  it('uses silent re-auth directly when no refresh token exists', async () => {
    const { silentReauth } = await import('./gisClient');
    const silentSpy = vi.mocked(silentReauth).mockResolvedValue({
      access_token: 'AT-SILENT-2',
      expires_in: 3600,
      scope: FULL_SCOPE,
      token_type: 'Bearer',
    });
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      // no refreshToken
    });
    expect(await performRefresh()).toBe('refreshed');
    expect(silentSpy).toHaveBeenCalledWith(undefined);
  });

  it('reports auth loss when Google refuses the silent re-auth', async () => {
    const { refreshAccessToken, silentReauth, GisFlowError } = await import('./gisClient');
    vi.mocked(refreshAccessToken).mockRejectedValue(new GisFlowError('grant failed'));
    vi.mocked(silentReauth).mockRejectedValue(new GisFlowError('interaction_required'));
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      refreshToken: 'RT-BAD',
    });
    expect(await performRefresh()).toBe('auth-lost');
    // tokens still present (the worker clears them, not performRefresh)
    const after = await getTokens();
    expect(after?.accessToken).toBe('AT-OLD');
    await clearTokens();
  });

  it('reports transient when the silent re-auth popup was blocked', async () => {
    const { silentReauth, GisFlowError } = await import('./gisClient');
    vi.mocked(silentReauth).mockRejectedValue(
      new GisFlowError('popup blocked', 'popup_failed_to_open'),
    );
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
    });
    expect(await performRefresh()).toBe('transient');
    expect((await getTokens())?.accessToken).toBe('AT-OLD');
    await clearTokens();
  });

  it('reports auth loss when the silent re-auth returns a different account', async () => {
    const { silentReauth, getUserInfo } = await import('./gisClient');
    vi.mocked(silentReauth).mockResolvedValue({
      access_token: 'AT-OTHER-ACCOUNT',
      expires_in: 3600,
      scope: FULL_SCOPE,
      token_type: 'Bearer',
    });
    vi.mocked(getUserInfo).mockResolvedValue({ sub: '2', email: 'someone-else@example.com' });
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      email: 'me@example.com',
    });
    expect(await performRefresh()).toBe('auth-lost');
    // The stranger's token must NOT have been written over ours — Drive sync
    // would have started reading and writing their App Folder.
    expect((await getTokens())?.accessToken).toBe('AT-OLD');
    await clearTokens();
  });

  it('keeps the session when the account check itself fails', async () => {
    const { silentReauth, getUserInfo } = await import('./gisClient');
    vi.mocked(silentReauth).mockResolvedValue({
      access_token: 'AT-SILENT-3',
      expires_in: 3600,
      scope: FULL_SCOPE,
      token_type: 'Bearer',
    });
    vi.mocked(getUserInfo).mockRejectedValue(new TypeError('Failed to fetch'));
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      email: 'me@example.com',
    });
    expect(await performRefresh()).toBe('refreshed');
    expect((await getTokens())?.accessToken).toBe('AT-SILENT-3');
    await clearTokens();
  });

  it('reports a narrowed scope without ending the session', async () => {
    const { refreshAccessToken } = await import('./gisClient');
    vi.mocked(refreshAccessToken).mockResolvedValue({
      access_token: 'AT-NARROW',
      expires_in: 3600,
      scope: 'openid email profile', // Drive access removed in Google settings
      token_type: 'Bearer',
    });
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      refreshToken: 'RT',
    });
    const onScopeNarrowed = vi.fn();
    expect(await performRefresh({ onScopeNarrowed })).toBe('refreshed');
    expect(onScopeNarrowed).toHaveBeenCalledTimes(1);
    await clearTokens();
  });

  it('does not report a narrowed scope when Drive access is intact', async () => {
    const { refreshAccessToken } = await import('./gisClient');
    vi.mocked(refreshAccessToken).mockResolvedValue({
      access_token: 'AT-OK',
      expires_in: 3600,
      scope: FULL_SCOPE,
      token_type: 'Bearer',
    });
    await setTokens({
      accessToken: 'AT-OLD',
      accessTokenExpiresAt: Date.now() - 1000,
      scope: FULL_SCOPE,
      refreshToken: 'RT',
    });
    const onScopeNarrowed = vi.fn();
    expect(await performRefresh({ onScopeNarrowed })).toBe('refreshed');
    expect(onScopeNarrowed).not.toHaveBeenCalled();
    await clearTokens();
  });
});
