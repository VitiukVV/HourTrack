import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import { db } from '@/lib/db';
import { AuthProvider } from '@/features/auth/AuthProvider';

import { RequireAuth } from './RequireAuth';

vi.mock('@/lib/google/gisClient', () => ({
  signIn: vi.fn(),
  revoke: vi.fn().mockResolvedValue(undefined),
  getUserInfo: vi.fn().mockResolvedValue({
    sub: 'sub-1',
    email: 'user@example.com',
    name: 'Test User',
    picture: null,
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
            <Route path="/login" element={<div data-testid="fake-login">LOGIN</div>} />
            <Route path="/" element={<RequireAuth />}>
              <Route index element={<div data-testid="protected">SECRET</div>} />
              <Route path="reports" element={<div data-testid="protected-reports">REPORTS</div>} />
            </Route>
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

describe('RequireAuth', () => {
  it('redirects unauthenticated users from / to /login', async () => {
    renderAt('/');
    await waitFor(() => {
      expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
      expect(screen.getByTestId('fake-login')).toBeInTheDocument();
    });
  });

  it('redirects unauthenticated users from /reports to /login', async () => {
    renderAt('/reports');
    await waitFor(() => {
      expect(screen.queryByTestId('protected-reports')).not.toBeInTheDocument();
      expect(screen.getByTestId('fake-login')).toBeInTheDocument();
    });
  });

  it('renders the protected child when tokens are present', async () => {
    const { setTokens } = await import('@/lib/google/tokenStore');
    await setTokens({
      accessToken: 'AT',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'openid email profile',
      email: 'pre@example.com',
      name: 'Pre User',
      picture: null,
    });
    renderAt('/');
    await waitFor(() => {
      expect(screen.getByTestId('protected')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('fake-login')).not.toBeInTheDocument();
  });
});
