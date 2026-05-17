import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import { db } from '@/lib/db';

import { AuthProvider } from './AuthProvider';
import { useAuth } from './authContext';

/**
 * Mock the gisClient module — we never want the test environment to actually
 * call `accounts.google.com`. The tokenStore IS exercised against
 * fake-indexeddb (the AuthProvider's job is to bridge tokenStore to React, so
 * stubbing tokenStore too would test nothing useful).
 */
vi.mock('@/lib/google/gisClient', () => ({
  signIn: vi.fn(),
  silentReauth: vi.fn(),
  revoke: vi.fn().mockResolvedValue(undefined),
  getUserInfo: vi.fn().mockResolvedValue({
    sub: 'sub-1',
    email: 'user@example.com',
    name: 'Test User',
    picture: 'https://example.com/avatar.png',
  }),
  refreshAccessToken: vi.fn(),
  GisFlowError: class extends Error {},
  GisNotConfiguredError: class extends Error {},
  GisNotReadyError: class extends Error {},
  isGisReady: () => true,
  waitForGisReady: () => Promise.resolve(),
  isSignInAvailable: () => true,
  getRedirectUri: () => 'http://localhost:5173',
}));

// Disable the background refresh worker — its timer would tick during tests
// and the auth flow we're verifying doesn't depend on it.
vi.mock('@/lib/google/tokenRefresh', () => ({
  startTokenRefresh: () => () => {
    /* noop disposer */
  },
  performRefresh: vi.fn(),
  nextRefreshDelay: vi.fn(),
}));

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

/**
 * Tiny consumer that surfaces the auth state to the DOM so tests can assert
 * via `screen` queries.
 */
function AuthStateProbe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="probe-status">{auth.status}</span>
      <span data-testid="probe-email">{auth.user?.email ?? ''}</span>
      <span data-testid="probe-name">{auth.user?.name ?? ''}</span>
      <span data-testid="probe-has-tokens">{auth.tokens ? 'yes' : 'no'}</span>
    </div>
  );
}

beforeEach(async () => {
  // Use the singleton DB instance (same as AuthProvider's internal modules).
  // Clear any leftover row from previous tests.
  await db.authTokens.clear();
  await db.settings.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AuthProvider', () => {
  it('starts with status="loading" and resolves to anonymous when no tokens exist', async () => {
    render(wrap(<AuthStateProbe />));
    // We may briefly see "loading", but the initial null snapshot fires
    // synchronously enough that "anonymous" is what we assert on.
    await waitFor(() => {
      expect(screen.getByTestId('probe-status').textContent).toBe('anonymous');
    });
    expect(screen.getByTestId('probe-has-tokens').textContent).toBe('no');
    expect(screen.getByTestId('probe-email').textContent).toBe('');
  });

  it('flips to authed when tokens are present in the store', async () => {
    const { setTokens } = await import('@/lib/google/tokenStore');
    await setTokens({
      accessToken: 'AT',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'openid email profile',
    });
    render(wrap(<AuthStateProbe />));
    await waitFor(() => {
      expect(screen.getByTestId('probe-status').textContent).toBe('authed');
    });
    expect(screen.getByTestId('probe-has-tokens').textContent).toBe('yes');
    // user-info fetch populates the profile shortly after
    await waitFor(() => {
      expect(screen.getByTestId('probe-email').textContent).toBe('user@example.com');
    });
    expect(screen.getByTestId('probe-name').textContent).toBe('Test User');
  });

  // Previously this test clicked a DOM button to fire `signOut()` and then
  // polled the DOM through `waitFor` for the status flip. That depends on
  // the tokenStore subscribe pump rendering React updates, which under
  // turbo parallel load (where dozens of fake-indexeddb-backed files
  // contend on a single in-process IDB) stalled past a 110s budget.
  // Rewritten to await `signOut()` imperatively via a captured auth
  // reference and check the tokenStore directly — same coverage, no
  // dependence on subscriber-render latency.
  it('signOut clears tokens and flips status to anonymous', async () => {
    const { setTokens, getTokens } = await import('@/lib/google/tokenStore');
    await setTokens({
      accessToken: 'AT',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'openid email profile',
    });

    let captured: ReturnType<typeof useAuth> | undefined;
    function Probe() {
      captured = useAuth();
      return null;
    }
    render(wrap(<Probe />));

    await waitFor(() => expect(captured?.status).toBe('authed'));

    await act(async () => {
      await captured!.signOut();
    });

    expect(await getTokens()).toBeNull();
    expect(captured?.status).toBe('anonymous');
  });

  it('uses cached profile from tokens row (no re-fetch when email already present)', async () => {
    const gisModule = await import('@/lib/google/gisClient');
    const userInfoSpy = vi.mocked(gisModule.getUserInfo);

    const { setTokens } = await import('@/lib/google/tokenStore');
    // Pre-cache the profile so AuthProvider doesn't need to fetch.
    await setTokens({
      accessToken: 'AT',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'openid email profile',
      email: 'cached@example.com',
      name: 'Cached User',
      picture: null,
    });

    render(wrap(<AuthStateProbe />));
    await waitFor(() => {
      expect(screen.getByTestId('probe-status').textContent).toBe('authed');
    });
    expect(screen.getByTestId('probe-email').textContent).toBe('cached@example.com');
    expect(userInfoSpy).not.toHaveBeenCalled();
  });

  it('sets Settings.firstLoginAt on the first authed transition', async () => {
    const { setTokens } = await import('@/lib/google/tokenStore');
    const { initDB, getSettings } = await import('@/lib/db');
    await initDB(db);
    await setTokens({
      accessToken: 'AT',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'openid email profile',
    });
    render(wrap(<AuthStateProbe />));
    await waitFor(() => {
      expect(screen.getByTestId('probe-email').textContent).toBe('user@example.com');
    });
    // The Settings.firstLoginAt write happens AFTER the user-info fetch
    // resolves (same effect, sequential awaits). Poll on the settings row
    // rather than asserting immediately so we don't race the write.
    await waitFor(async () => {
      const settings = await getSettings(db);
      expect(settings?.firstLoginAt).not.toBeNull();
    });
  });

  it('throws when useAuth is called outside the provider', () => {
    // Silence the expected React error log
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bad() {
      useAuth();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/useAuth\(\) called outside/);
    spy.mockRestore();
  });
});
