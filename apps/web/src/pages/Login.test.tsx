import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import { db } from '@/lib/db';
import { AuthProvider } from '@/features/auth/AuthProvider';

import { LoginPage } from './Login';

const ORIGINAL_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function setClientId(value: string | undefined): void {
  if (value === undefined) {
    delete (import.meta.env as Record<string, unknown>).VITE_GOOGLE_CLIENT_ID;
  } else {
    (import.meta.env as Record<string, unknown>).VITE_GOOGLE_CLIENT_ID = value;
  }
}

vi.mock('@/lib/google/gisClient', () => ({
  signIn: vi.fn().mockResolvedValue({
    access_token: 'AT-1',
    expires_in: 3600,
    scope: 'openid email profile',
    token_type: 'Bearer',
  }),
  silentReauth: vi.fn(),
  revoke: vi.fn().mockResolvedValue(undefined),
  getUserInfo: vi.fn().mockResolvedValue({
    sub: 'sub-1',
    email: 'user@example.com',
    name: 'Test User',
    picture: null,
  }),
  refreshAccessToken: vi.fn(),
  GisFlowError: class GisFlowError extends Error {
    code?: string;
    constructor(message: string, code?: string) {
      super(message);
      this.name = 'GisFlowError';
      this.code = code;
    }
  },
  GisNotConfiguredError: class extends Error {},
  GisNotReadyError: class extends Error {},
  isUserCancelledSignIn: (err: unknown) =>
    err instanceof Error &&
    err.name === 'GisFlowError' &&
    ((err as { code?: string }).code === 'popup_closed' ||
      (err as { code?: string }).code === 'popup_failed_to_open'),
  isGisReady: () => true,
  waitForGisReady: () => Promise.resolve(),
  isSignInAvailable: () => true,
  getRedirectUri: () => 'http://localhost:5173',
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/google/tokenRefresh', () => ({
  startTokenRefresh: () => () => {
    /* noop disposer */
  },
  performRefresh: vi.fn(),
  nextRefreshDelay: vi.fn(),
}));

function renderAt(initialPath: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<div data-testid="home">HOME</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await db.authTokens.clear();
  setClientId('test-client.apps.googleusercontent.com');
});

afterEach(() => {
  setClientId(ORIGINAL_CLIENT_ID as string | undefined);
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  it('renders the sign-in button when configured + SDK ready + anonymous', async () => {
    renderAt('/login');
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    // AuthProvider starts in `loading` state and resolves to `anonymous` on the
    // initial tokenStore snapshot. The button is disabled while loading; wait
    // for the post-resolution enabled state.
    await waitFor(() => {
      expect(screen.getByTestId('login-button')).not.toBeDisabled();
    });
  });

  it('shows the "not configured" message when VITE_GOOGLE_CLIENT_ID is missing', async () => {
    setClientId(undefined);
    renderAt('/login');
    expect(await screen.findByTestId('login-not-configured')).toBeInTheDocument();
    expect(screen.queryByTestId('login-button')).not.toBeInTheDocument();
  });

  it('shows the "not configured" message when env still has the placeholder', async () => {
    setClientId('your-client-id-here.apps.googleusercontent.com');
    renderAt('/login');
    expect(await screen.findByTestId('login-not-configured')).toBeInTheDocument();
  });

  it('calls gisClient.signIn on button click and stores tokens', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    const button = await screen.findByTestId('login-button');
    const gisModule = await import('@/lib/google/gisClient');
    const signInSpy = vi.mocked(gisModule.signIn);

    await user.click(button);
    expect(signInSpy).toHaveBeenCalledTimes(1);
    await waitFor(async () => {
      const row = await db.authTokens.get('current');
      expect(row?.accessToken).toBe('AT-1');
    });
  });

  it('stays silent (no error toast) when the user cancels the popup', async () => {
    const user = userEvent.setup();
    const gisModule = await import('@/lib/google/gisClient');
    const { toast } = await import('sonner');
    const cancelled = new gisModule.GisFlowError('Popup window closed', 'popup_closed');
    vi.mocked(gisModule.signIn).mockRejectedValueOnce(cancelled);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderAt('/login');
    const button = await screen.findByTestId('login-button');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByTestId('login-button')).not.toBeDisabled();
    });
    // No login-error toast, no "signIn failed" warn. (Other toasts from the
    // AuthProvider bootstrap are out of scope for this assertion.)
    expect(vi.mocked(toast.error)).not.toHaveBeenCalledWith('Sign-in failed. Please try again.');
    expect(warnSpy).not.toHaveBeenCalledWith('[LoginPage] signIn failed', expect.anything());
    warnSpy.mockRestore();
  });

  it('shows an error toast on a genuine sign-in failure', async () => {
    const user = userEvent.setup();
    const gisModule = await import('@/lib/google/gisClient');
    const { toast } = await import('sonner');
    vi.mocked(gisModule.signIn).mockRejectedValueOnce(
      new gisModule.GisFlowError('access_denied', 'unknown'),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderAt('/login');
    const button = await screen.findByTestId('login-button');
    await user.click(button);

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Sign-in failed. Please try again.');
    });
    warnSpy.mockRestore();
  });

  it('redirects to / after a successful sign-in (already-authed effect)', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    const button = await screen.findByTestId('login-button');
    await user.click(button);
    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument();
    });
  });
});
