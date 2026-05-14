import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import { db } from '@/lib/db';
import { AuthProvider } from '@/features/auth/AuthProvider';

import { ProfileSection } from './ProfileSection';

vi.mock('@/lib/google/gisClient', () => ({
  signIn: vi.fn(),
  revoke: vi.fn().mockResolvedValue(undefined),
  getUserInfo: vi.fn().mockResolvedValue({
    sub: 'sub-1',
    email: 'pre@example.com',
    name: 'Pre User',
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
            <Route path="/settings" element={<ProfileSection />} />
            <Route path="/login" element={<div data-testid="login-redirect">LOGIN</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await db.authTokens.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProfileSection', () => {
  it('shows "Not signed in" + sign-in button when anonymous', async () => {
    renderAt('/settings');
    await waitFor(() => {
      expect(screen.getByTestId('settings-profile-status')).toBeInTheDocument();
    });
    expect(screen.getByTestId('settings-profile-status').textContent).toMatch(
      /Not signed in|Ви не увійшли|No has iniciado/,
    );
  });

  it('shows avatar + name + email + Logout when authed', async () => {
    const { setTokens } = await import('@/lib/google/tokenStore');
    await setTokens({
      accessToken: 'AT',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'openid email profile',
      email: 'pre@example.com',
      name: 'Pre User',
      picture: 'https://example.com/avatar.png',
    });

    renderAt('/settings');
    await waitFor(() => {
      expect(screen.getByTestId('settings-profile-email').textContent).toBe('pre@example.com');
    });
    expect(screen.getByTestId('settings-profile-name').textContent).toBe('Pre User');
    expect(screen.getByTestId('settings-profile-avatar').getAttribute('src')).toBe(
      'https://example.com/avatar.png',
    );
    expect(screen.getByTestId('settings-profile-logout')).toBeInTheDocument();
  });

  it('Logout clears tokens and navigates to /login', async () => {
    const { setTokens } = await import('@/lib/google/tokenStore');
    await setTokens({
      accessToken: 'AT',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'openid email profile',
      email: 'pre@example.com',
      name: 'Pre User',
      picture: null,
    });

    const user = userEvent.setup();
    renderAt('/settings');
    await waitFor(() => {
      expect(screen.getByTestId('settings-profile-logout')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('settings-profile-logout'));
    await waitFor(() => {
      expect(screen.getByTestId('login-redirect')).toBeInTheDocument();
    });
    const tokens = await db.authTokens.get('current');
    expect(tokens).toBeUndefined();
  });
});
