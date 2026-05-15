import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import '@/lib/i18n';
import i18n, { LANGUAGE_STORAGE_KEY } from '@/lib/i18n';
import { db } from '@/lib/db';
import { ROUTES, type RouteConfig } from '@/app/routes';
import { AuthProvider } from '@/features/auth/AuthProvider';

// AppRouter wraps RouterProvider with createBrowserRouter, which we don't want to
// instantiate in tests (it claims window history). Compose the same shared
// `ROUTES` array under MemoryRouter so the production tree and the test tree
// can never drift (S01 followup — previously the tests re-declared the route
// table verbatim).
//
// S09 wraps protected routes in `<RequireAuth />`; to keep the existing smoke
// tests focused on layout/i18n behavior, we seed an authed tokens row in
// `beforeEach`. The dedicated login/redirect tests live in
// `pages/Login.test.tsx` and `app/RequireAuth.test.tsx`.

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

function renderRouteConfig(routes: RouteConfig[]): ReturnType<typeof Route>[] {
  return routes.map((r, idx) => {
    if (r.index) {
      return <Route key={`idx-${idx}`} index element={r.element} />;
    }
    return (
      <Route
        // path is non-undefined here because index branch is handled above
        key={`p-${r.path ?? idx}`}
        path={r.path}
        element={r.element}
      >
        {r.children ? renderRouteConfig(r.children) : null}
      </Route>
    );
  });
}

function renderAt(path: string) {
  // Fresh QueryClient per render: CardsHeader (mounted by AppLayout on
  // calendar/day/reports surfaces, see S03) calls useCardsQuery which needs
  // a provider in scope.
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>{renderRouteConfig(ROUTES)}</Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

async function seedAuthed(): Promise<void> {
  // Pre-cache profile fields so AuthProvider doesn't kick off a user-info
  // fetch during the smoke render. Email present -> AuthProvider takes the
  // cached path and stays stable.
  await db.authTokens.put({
    key: 'current',
    accessToken: 'AT',
    accessTokenExpiresAt: Date.now() + 3_600_000,
    refreshToken: null,
    idToken: null,
    scope: 'openid email profile',
    email: 'user@example.com',
    name: 'Test User',
    picture: null,
  });
}

describe('App smoke', () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.authTokens.clear();
    await seedAuthed();
    void i18n.changeLanguage('uk');
  });

  it('renders the home page without crashing under the layout', async () => {
    renderAt('/');
    // The layout shows the app title in header
    await waitFor(() => {
      expect(screen.getAllByText(/HourTrack/).length).toBeGreaterThan(0);
    });
    // S04 replaced the home placeholder with the CalendarHeader+MonthView
    // surface; we assert the calendar header mount as the route's smoke
    // signal.
    expect(await screen.findByTestId('calendar-header')).toBeInTheDocument();
  });

  it('mounts /login with a localized page marker', async () => {
    renderAt('/login');
    // S09 replaced the page-marker subtitle with a localized auth.login.title
    expect(await screen.findByTestId('login-page-subtitle')).toBeInTheDocument();
  });

  it('mounts /settings with the S08 settings surface (no longer a placeholder)', async () => {
    renderAt('/settings');
    expect(await screen.findByTestId('settings-page')).toBeInTheDocument();
  });

  it('mounts /reports with the S07 reports surface (no longer a placeholder)', async () => {
    renderAt('/reports');
    // /reports is now lazy-loaded (S13 task #8). The dynamic import + Suspense
    // resolution can take longer than the default 1s in cold-cache test runs;
    // bump the timeout to give it room.
    expect(
      await screen.findByTestId('reports-filters', undefined, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });

  it('mounts /day/:date with the S06 day page surface (no longer a placeholder)', async () => {
    renderAt('/day/2026-05-14');
    expect(await screen.findByTestId('day-page')).toBeInTheDocument();
  });

  it('mounts route / with the calendar surface', async () => {
    renderAt('/');
    expect(await screen.findByTestId('calendar-header')).toBeInTheDocument();
    expect(screen.getByTestId('month-view')).toBeInTheDocument();
  });

  it('shows localized nav labels in current language (default uk)', async () => {
    renderAt('/');
    await waitFor(() => {
      // Mobile nav and desktop nav both render the labels -- assert at least one match per label
      expect(screen.getAllByText('Календар').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Звіти').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Налаштування').length).toBeGreaterThan(0);
  });
});

describe('LanguageSwitcher', () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.authTokens.clear();
    await seedAuthed();
    void i18n.changeLanguage('uk');
  });

  it('changes locale when a different language is selected and persists to localStorage', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const switcher = await screen.findByTestId('language-switcher');
    expect(switcher).toBeInTheDocument();

    // Open the Select and pick English. The Radix listbox renders into a portal,
    // so we query the document for the option after opening.
    await user.click(switcher);
    const englishOption = await screen.findByRole('option', { name: 'English' });
    await user.click(englishOption);

    // i18n should now be English -- the home page marker switches text
    expect(i18n.resolvedLanguage).toBe('en');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');

    // The home-page nav label flips to English
    expect(screen.getAllByText('Calendar').length).toBeGreaterThan(0);
  });

  it('supports all three locales (uk, en, es)', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const switcher = await screen.findByTestId('language-switcher');
    await user.click(switcher);

    // Each locale must be listed
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: 'Українська' })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: 'English' })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: 'Español' })).toBeInTheDocument();
  });

  it('falls back to en when the resolved language is unsupported (e.g. de-DE)', async () => {
    // Force i18next into a tag it does not know — the LanguageSwitcher
    // normalizer must coerce to `en` rather than displaying a blank Select.
    await i18n.changeLanguage('de-DE');
    renderAt('/');
    // The Select trigger shows the current value's display label. We
    // assert the underlying SelectValue reflects English even though the
    // resolved language is the unknown `de-DE`. Reading the trigger's
    // visible text is the cleanest way to check this end-to-end.
    const switcher = await screen.findByTestId('language-switcher');
    expect(switcher.textContent ?? '').toMatch(/English/);
  });
});
