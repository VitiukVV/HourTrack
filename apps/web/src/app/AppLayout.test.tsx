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

describe('AppLayout — header / bottom-nav', () => {
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

    // Wait for the layout to settle (language switcher is always rendered
    // and is a stable post-mount probe).
    await waitFor(() => {
      expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    });

    // The SyncIndicator's `data-testid="sync-indicator"` MUST not appear
    // inside the AppLayout's `<header>` anymore. It lives in Settings.
    const indicator = screen.queryByTestId('sync-indicator');
    if (indicator) {
      let node: HTMLElement | null = indicator;
      while (node) {
        expect(node.tagName).not.toBe('HEADER');
        node = node.parentElement;
      }
    }
  });

  it('does NOT render a ProfileMenu in the header (user request)', async () => {
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
      expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    });

    // ProfileMenu was removed from the header — Settings still hosts the
    // sign-out flow under ProfileSection. The icon-only avatar `<img>`
    // can't render at the chrome layer because the component isn't here.
    expect(screen.queryByTestId('profile-menu')).toBeNull();
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

  // S20 Task 14 — CardsHeader is no longer rendered on /reports. Reports
  // owns its own multi-select chip row (inside ReportsFilters) and does
  // not use active-card semantics.
  it('does NOT render CardsHeader on /reports (S20 Task 14)', async () => {
    render(wrap('/reports', <AppLayout />));
    // CardsHeader is the global "active-card carousel" — its data-testid
    // is `cards-header`. We only need to assert absence — the page-level
    // content under Suspense doesn't have to resolve for this assertion.
    expect(screen.queryByTestId('cards-header')).not.toBeInTheDocument();
  });

  it('still renders CardsHeader on the calendar (/) and day (/day/...) routes', async () => {
    const { unmount } = render(wrap('/', <AppLayout />));
    await waitFor(() => {
      expect(screen.queryByTestId('cards-header')).toBeInTheDocument();
    });
    unmount();

    render(wrap('/day/2026-05-14', <AppLayout />));
    await waitFor(() => {
      expect(screen.queryByTestId('cards-header')).toBeInTheDocument();
    });
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
