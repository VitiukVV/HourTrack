import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import { db } from '@/lib/db';
import { AuthProvider } from '@/features/auth/AuthProvider';

import { AppLayout } from './AppLayout';

vi.mock('@/lib/google/gisClient', () => ({
  signIn: vi.fn(),
  revoke: vi.fn().mockResolvedValue(undefined),
  getUserInfo: vi.fn().mockResolvedValue({
    sub: 'sub-1',
    email: 'me@example.com',
    name: 'Me',
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
    /* noop */
  },
  performRefresh: vi.fn(),
  nextRefreshDelay: vi.fn(),
}));

function wrap(initial: string, children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
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

describe('AppLayout — S19 Header / Bottom-nav changes', () => {
  it('does NOT render a SyncIndicator in the header (Task 23)', async () => {
    const { setTokens } = await import('@/lib/google/tokenStore');
    await setTokens({
      accessToken: 'AT',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'openid email profile',
      email: 'me@example.com',
      name: 'Me',
      picture: 'https://example.com/avatar.png',
    });

    render(wrap('/', <AppLayout />));

    // Wait for the auth status to flip to `authed` so any conditional
    // render that depended on it (the OLD SyncIndicator gating) has had
    // a chance to mount.
    await waitFor(() => {
      expect(screen.getByTestId('profile-menu')).toBeInTheDocument();
    });

    // The SyncIndicator's `data-testid="sync-indicator"` MUST not appear
    // inside the AppLayout's `<header>` anymore. It lives in Settings.
    const indicator = screen.queryByTestId('sync-indicator');
    if (indicator) {
      // If the indicator is somehow rendered, make sure it's not inside
      // the chrome header. Walk up the DOM checking for a `<header>`
      // ancestor — if we find one, fail.
      let node: HTMLElement | null = indicator;
      while (node) {
        expect(node.tagName).not.toBe('HEADER');
        node = node.parentElement;
      }
    }
  });

  it('does NOT render an avatar `<img>` in the header (Task 24)', async () => {
    const { setTokens } = await import('@/lib/google/tokenStore');
    await setTokens({
      accessToken: 'AT',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'openid email profile',
      email: 'me@example.com',
      name: 'Me',
      picture: 'https://example.com/avatar.png',
    });

    render(wrap('/settings', <AppLayout />));

    await waitFor(() => {
      expect(screen.getByTestId('profile-menu')).toBeInTheDocument();
    });

    // S19: the ProfileMenu trigger is icon-only — no `<img>` anywhere
    // in the document at the chrome layer.
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders the bottom-nav with `sm:hidden` (mobile/tablet only, Task 25)', () => {
    render(wrap('/', <AppLayout />));

    const bottomNav = screen.getByTestId('bottom-nav');
    expect(bottomNav.className).toContain('sm:hidden');
    // Verify it's `sticky bottom-0` so it does NOT hide on scroll.
    expect(bottomNav.className).toMatch(/sticky/);
    expect(bottomNav.className).toMatch(/bottom-0/);
  });

  it('active bottom-nav route gets `border-primary` + `bg-primary/5` (Task 26)', () => {
    render(wrap('/reports', <AppLayout />));

    const bottomNav = screen.getByTestId('bottom-nav');
    // Inside the bottom nav, find the active NavLink for /reports.
    const links = bottomNav.querySelectorAll('a');
    let activeLink: HTMLAnchorElement | null = null;
    for (const a of links) {
      if (a.getAttribute('href') === '/reports') {
        activeLink = a;
      }
    }
    expect(activeLink).not.toBeNull();
    expect(activeLink!.className).toContain('border-primary');
    expect(activeLink!.className).toContain('bg-primary/5');
    expect(activeLink!.className).toContain('text-foreground');
    expect(activeLink!.className).toContain('font-medium');
  });

  it('inactive bottom-nav routes use border-transparent (no layout shift)', () => {
    render(wrap('/reports', <AppLayout />));

    const bottomNav = screen.getByTestId('bottom-nav');
    const links = bottomNav.querySelectorAll('a');
    for (const a of links) {
      const href = a.getAttribute('href');
      if (href !== '/reports') {
        expect(a.className).toContain('border-transparent');
        expect(a.className).toContain('text-muted-foreground');
        // Verify the inactive class still has the same border-t-2 width
        // so switching routes doesn't shift layout by 2px.
        expect(a.className).toContain('border-t-2');
      }
    }
  });
});
