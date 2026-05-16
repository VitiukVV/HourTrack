import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import { db } from '@/lib/db';

import { AuthProvider } from './AuthProvider';
import { ProfileMenu } from './ProfileMenu';

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

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await db.authTokens.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProfileMenu', () => {
  it('renders nothing when anonymous', async () => {
    const { container } = render(wrap(<ProfileMenu />));
    await waitFor(() => {
      expect(container.querySelector('[data-testid="profile-menu"]')).toBeNull();
    });
  });

  it('renders an icon-only profile button when authed (S19: no avatar photo)', async () => {
    const { setTokens } = await import('@/lib/google/tokenStore');
    await setTokens({
      accessToken: 'AT',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'openid email profile',
      email: 'pre@example.com',
      name: 'Pre User',
      picture: 'https://example.com/avatar.png',
    });

    render(wrap(<ProfileMenu />));
    // S19 (Task 24) — the avatar `<img>` is replaced with a plain
    // `<UserCircle />` lucide icon. The picture URL must NOT render in
    // the chrome anywhere; the email is still surfaced inside the
    // popover content (covered by the next test).
    await waitFor(() => {
      expect(screen.getByTestId('profile-menu')).toBeInTheDocument();
    });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('opens a menu with email + Logout when clicked', async () => {
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
    render(wrap(<ProfileMenu />));
    await waitFor(() => {
      expect(screen.getByTestId('profile-menu')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button'));
    expect(await screen.findByText('pre@example.com')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Log out|Cerrar|Вийти/i })).toBeInTheDocument();
  });
});
