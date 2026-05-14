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
  waitForGisReady,
} from './gisClient';

/**
 * Mock the global `google.accounts.oauth2` SDK. We never make real OAuth
 * calls -- the SDK surface is small enough that a hand-rolled mock is
 * cleaner than reaching for a library.
 */

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_GOOGLE = (globalThis as { google?: unknown }).google;
const ORIGINAL_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function setClientId(value: string | undefined): void {
  // Vite exposes `import.meta.env` as a mutable object in test mode. Patch
  // and restore in tests rather than using `vi.stubGlobal` to keep things
  // simple.
  if (value === undefined) {
    delete (import.meta.env as Record<string, unknown>).VITE_GOOGLE_CLIENT_ID;
  } else {
    (import.meta.env as Record<string, unknown>).VITE_GOOGLE_CLIENT_ID = value;
  }
}

interface MockCodeClient {
  requestCode: () => void;
}

function installGoogleSdk(opts: {
  responseCode?: string;
  responseScope?: string;
  failWith?: { type: string; message?: string };
  revokeSuccess?: boolean;
}): {
  initCodeClient: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
} {
  const initCodeClient = vi.fn(
    (cfg: {
      callback: (r: { code: string; scope: string }) => void;
      error_callback?: (e: { type: string; message?: string }) => void;
    }): MockCodeClient => {
      return {
        requestCode: () => {
          if (opts.failWith) {
            // Defer so the requestCode call returns before the rejection fires
            // -- mimics GIS behavior.
            setTimeout(() => cfg.error_callback?.(opts.failWith!), 0);
            return;
          }
          setTimeout(
            () =>
              cfg.callback({
                code: opts.responseCode ?? 'AUTH-CODE-MOCK',
                scope: opts.responseScope ?? 'openid email profile',
              }),
            0,
          );
        },
      };
    },
  );

  const revokeFn = vi.fn(
    (_token: string, cb: (r: { successful: boolean; error?: string }) => void) => {
      cb({ successful: opts.revokeSuccess ?? true });
    },
  );

  (globalThis as { google?: unknown }).google = {
    accounts: {
      oauth2: {
        initCodeClient,
        revoke: revokeFn,
      },
    },
  };
  return { initCodeClient, revoke: revokeFn };
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
    // happy-dom sets origin to http://localhost:3000 by default; assert shape
    expect(getRedirectUri()).toMatch(/^https?:\/\//);
  });
});

describe('isGisReady / waitForGisReady', () => {
  it('isGisReady is false when google is undefined', () => {
    delete (globalThis as { google?: unknown }).google;
    expect(isGisReady()).toBe(false);
  });

  it('isGisReady is true after SDK install', () => {
    installGoogleSdk({});
    expect(isGisReady()).toBe(true);
  });

  it('waitForGisReady resolves when SDK is already loaded', async () => {
    installGoogleSdk({});
    await expect(waitForGisReady(100)).resolves.toBeUndefined();
  });

  it('waitForGisReady rejects after timeout when SDK never loads', async () => {
    delete (globalThis as { google?: unknown }).google;
    await expect(waitForGisReady(50)).rejects.toThrow(/not ready/i);
  });
});

describe('isSignInAvailable', () => {
  it('is true when client ID is set AND GIS is ready', () => {
    installGoogleSdk({});
    expect(isSignInAvailable()).toBe(true);
  });

  it('is false when client ID is missing', () => {
    setClientId(undefined);
    installGoogleSdk({});
    expect(isSignInAvailable()).toBe(false);
  });

  it('is false when client ID is the .env.example placeholder', () => {
    setClientId('your-client-id-here.apps.googleusercontent.com');
    installGoogleSdk({});
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
    installGoogleSdk({});
    await expect(signIn()).rejects.toBeInstanceOf(GisNotConfiguredError);
  });

  it('calls initCodeClient with PKCE challenge + scopes', async () => {
    const { initCodeClient } = installGoogleSdk({ responseCode: 'CODE-X' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'AT',
        expires_in: 3600,
        scope: 'openid email profile',
        token_type: 'Bearer',
      }),
    }) as unknown as typeof fetch;

    await signIn();

    expect(initCodeClient).toHaveBeenCalledTimes(1);
    const cfg = initCodeClient.mock.calls[0]![0] as {
      client_id: string;
      scope: string;
      ux_mode: string;
      code_challenge: string;
      code_challenge_method: string;
    };
    expect(cfg.client_id).toBe('test-client-id.apps.googleusercontent.com');
    expect(cfg.ux_mode).toBe('popup');
    expect(cfg.code_challenge_method).toBe('S256');
    expect(cfg.code_challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cfg.scope).toContain('openid email profile');
    expect(cfg.scope).toContain('calendar.app.created');
    expect(cfg.scope).toContain('drive.appdata');
  });

  it('exchanges auth code at the token endpoint with PKCE verifier', async () => {
    installGoogleSdk({ responseCode: 'CODE-EXCHANGE' });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'AT-FINAL',
        expires_in: 3600,
        scope: 'openid email profile',
        token_type: 'Bearer',
        refresh_token: 'RT-FINAL',
      }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const tokens = await signIn();
    expect(tokens.access_token).toBe('AT-FINAL');
    expect(tokens.refresh_token).toBe('RT-FINAL');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect((init as { method: string }).method).toBe('POST');
    const body = (init as { body: string }).body;
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=CODE-EXCHANGE');
    expect(body).toContain('code_verifier=');
    expect(body).toContain('client_id=test-client-id');
  });

  it('throws GisFlowError when GIS callback errors', async () => {
    installGoogleSdk({ failWith: { type: 'popup_closed', message: 'User closed popup' } });
    await expect(signIn()).rejects.toBeInstanceOf(GisFlowError);
  });

  it('throws GisFlowError on non-2xx from token endpoint', async () => {
    installGoogleSdk({ responseCode: 'CODE-FAIL' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid_grant"}',
    }) as unknown as typeof fetch;
    await expect(signIn()).rejects.toBeInstanceOf(GisFlowError);
  });

  it("passes prompt: 'none' when requested for silent re-auth", async () => {
    const { initCodeClient } = installGoogleSdk({});
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'AT',
        expires_in: 3600,
        scope: 'openid email profile',
        token_type: 'Bearer',
      }),
    }) as unknown as typeof fetch;
    await signIn({ prompt: 'none' });
    const cfg = initCodeClient.mock.calls[0]![0] as { prompt?: string };
    expect(cfg.prompt).toBe('none');
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
