import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GisFlowError,
  GisNotConfiguredError,
  getRedirectUri,
  isGisReady,
  isSignInAvailable,
  refreshAccessToken,
  revoke,
  signIn,
  silentReauth,
  waitForGisReady,
} from './gisClient';

/**
 * Mock the global `google.accounts.oauth2` SDK. The interactive sign-in
 * flow is `initTokenClient` (no `/token` exchange, no PKCE) — see the
 * module header in `gisClient.ts` for the rationale.
 */

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_GOOGLE = (globalThis as { google?: unknown }).google;
const ORIGINAL_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function setClientId(value: string | undefined): void {
  if (value === undefined) {
    delete (import.meta.env as Record<string, unknown>).VITE_GOOGLE_CLIENT_ID;
  } else {
    (import.meta.env as Record<string, unknown>).VITE_GOOGLE_CLIENT_ID = value;
  }
}

interface InstallOpts {
  tokenResponse?: {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  tokenError?: { type: string; message?: string };
  revokeSuccess?: boolean;
}

function installGoogleSdk(opts: InstallOpts = {}): {
  initTokenClient: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
  requestAccessToken: ReturnType<typeof vi.fn>;
} {
  const requestAccessToken = vi.fn();
  const initTokenClient = vi.fn(
    (cfg: {
      callback: (r: Record<string, unknown>) => void;
      error_callback?: (e: { type: string; message?: string }) => void;
    }) => ({
      requestAccessToken: () => {
        requestAccessToken();
        if (opts.tokenError) {
          setTimeout(() => cfg.error_callback?.(opts.tokenError!), 0);
          return;
        }
        setTimeout(
          () =>
            cfg.callback(
              opts.tokenResponse ?? {
                access_token: 'AT-MOCK',
                expires_in: 3600,
                scope: 'openid email profile',
                token_type: 'Bearer',
              },
            ),
          0,
        );
      },
    }),
  );

  const revokeFn = vi.fn(
    (_token: string, cb: (r: { successful: boolean; error?: string }) => void) => {
      cb({ successful: opts.revokeSuccess ?? true });
    },
  );

  // Stub initCodeClient to a no-op so any leftover callers don't crash.
  const initCodeClient = vi.fn(() => ({ requestCode: () => {} }));

  (globalThis as { google?: unknown }).google = {
    accounts: {
      oauth2: {
        initCodeClient,
        initTokenClient,
        revoke: revokeFn,
      },
    },
  };
  return { initTokenClient, revoke: revokeFn, requestAccessToken };
}

beforeEach(() => {
  setClientId('test-client-id.apps.googleusercontent.com');
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  (globalThis as { google?: unknown }).google = ORIGINAL_GOOGLE;
  setClientId(ORIGINAL_CLIENT_ID as string | undefined);
});

describe('getRedirectUri', () => {
  it('returns window.location.origin in a DOM env', () => {
    expect(getRedirectUri()).toMatch(/^https?:\/\//);
  });
});

describe('isGisReady / waitForGisReady', () => {
  it('isGisReady is false when google is undefined', () => {
    delete (globalThis as { google?: unknown }).google;
    expect(isGisReady()).toBe(false);
  });

  it('isGisReady is true after SDK install', () => {
    installGoogleSdk();
    expect(isGisReady()).toBe(true);
  });

  it('waitForGisReady resolves when SDK is already loaded', async () => {
    installGoogleSdk();
    await expect(waitForGisReady(100)).resolves.toBeUndefined();
  });

  it('waitForGisReady rejects after timeout when SDK never loads', async () => {
    delete (globalThis as { google?: unknown }).google;
    await expect(waitForGisReady(50)).rejects.toThrow(/not ready/i);
  });
});

describe('isSignInAvailable', () => {
  it('is true when client ID is set AND GIS is ready', () => {
    installGoogleSdk();
    expect(isSignInAvailable()).toBe(true);
  });

  it('is false when client ID is missing', () => {
    setClientId(undefined);
    installGoogleSdk();
    expect(isSignInAvailable()).toBe(false);
  });

  it('is false when client ID is the .env.example placeholder', () => {
    setClientId('your-client-id-here.apps.googleusercontent.com');
    installGoogleSdk();
    expect(isSignInAvailable()).toBe(false);
  });

  it('is false when GIS is not ready', () => {
    delete (globalThis as { google?: unknown }).google;
    expect(isSignInAvailable()).toBe(false);
  });
});

describe('signIn', () => {
  it('throws GisNotConfiguredError when client ID is missing', async () => {
    setClientId(undefined);
    installGoogleSdk();
    await expect(signIn()).rejects.toBeInstanceOf(GisNotConfiguredError);
  });

  it('calls initTokenClient with the scope and resolves with the access token', async () => {
    const { initTokenClient, requestAccessToken } = installGoogleSdk();
    const res = await signIn();
    expect(res.access_token).toBe('AT-MOCK');
    expect(res.expires_in).toBe(3600);
    expect(initTokenClient).toHaveBeenCalledTimes(1);
    expect(requestAccessToken).toHaveBeenCalledTimes(1);
    const cfg = initTokenClient.mock.calls[0]![0] as {
      client_id: string;
      scope: string;
      prompt?: string;
      hint?: string;
    };
    expect(cfg.client_id).toBe('test-client-id.apps.googleusercontent.com');
    expect(cfg.scope).toContain('openid email profile');
    expect(cfg.scope).toContain('calendar.app.created');
    expect(cfg.scope).toContain('drive.appdata');
  });

  it("passes prompt:'none' through for silent re-auth", async () => {
    const { initTokenClient } = installGoogleSdk();
    await signIn({ prompt: 'none', hint: 'user@example.com' });
    const cfg = initTokenClient.mock.calls[0]![0] as { prompt?: string; hint?: string };
    expect(cfg.prompt).toBe('none');
    expect(cfg.hint).toBe('user@example.com');
  });

  it('throws GisFlowError on error_callback', async () => {
    installGoogleSdk({ tokenError: { type: 'popup_closed', message: 'user cancelled' } });
    await expect(signIn()).rejects.toBeInstanceOf(GisFlowError);
  });

  it('throws GisFlowError when callback returns an error response', async () => {
    installGoogleSdk({
      tokenResponse: { error: 'interaction_required', error_description: 'login required' },
    });
    await expect(signIn()).rejects.toThrow(/interaction_required/);
  });

  it('throws GisFlowError when response is missing access_token', async () => {
    installGoogleSdk({ tokenResponse: { scope: 'x' } });
    await expect(signIn()).rejects.toThrow(/no access_token/i);
  });
});

describe('silentReauth', () => {
  it("delegates to signIn with prompt:'none'", async () => {
    const { initTokenClient } = installGoogleSdk();
    await silentReauth('hint@example.com');
    const cfg = initTokenClient.mock.calls[0]![0] as { prompt?: string; hint?: string };
    expect(cfg.prompt).toBe('none');
    expect(cfg.hint).toBe('hint@example.com');
  });
});

describe('refreshAccessToken', () => {
  it('throws GisNotConfiguredError when client ID is missing', async () => {
    setClientId(undefined);
    await expect(refreshAccessToken('RT')).rejects.toBeInstanceOf(GisNotConfiguredError);
  });

  it('POSTs grant_type=refresh_token to the token endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'AT-2',
        expires_in: 3600,
        scope: 'openid email profile',
        token_type: 'Bearer',
      }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const tokens = await refreshAccessToken('RT-IN');
    expect(tokens.access_token).toBe('AT-2');
    const body = fetchSpy.mock.calls[0]![1] as { body: string };
    expect(body.body).toContain('grant_type=refresh_token');
    expect(body.body).toContain('refresh_token=RT-IN');
  });

  it('throws GisFlowError on refresh failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid_grant"}',
    }) as unknown as typeof fetch;
    await expect(refreshAccessToken('RT-BAD')).rejects.toBeInstanceOf(GisFlowError);
  });
});

describe('revoke', () => {
  it('calls google.accounts.oauth2.revoke when SDK is loaded', async () => {
    const { revoke: spy } = installGoogleSdk({ revokeSuccess: true });
    await revoke('TOKEN-TO-REVOKE');
    expect(spy).toHaveBeenCalledWith('TOKEN-TO-REVOKE', expect.any(Function));
  });

  it('resolves even when the SDK reports failure (best-effort)', async () => {
    installGoogleSdk({ revokeSuccess: false });
    await expect(revoke('T')).resolves.toBeUndefined();
  });

  it('falls back to fetch when SDK is not loaded', async () => {
    delete (globalThis as { google?: unknown }).google;
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as unknown as typeof fetch;
    await revoke('FALLBACK-TOKEN');
    expect(fetchSpy).toHaveBeenCalled();
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('oauth2.googleapis.com/revoke');
    expect(url).toContain('FALLBACK-TOKEN');
  });
});
