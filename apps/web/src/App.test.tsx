import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import '@/lib/i18n';
import i18n, { LANGUAGE_STORAGE_KEY } from '@/lib/i18n';
import { ROUTES, type RouteConfig } from '@/app/routes';

// AppRouter wraps RouterProvider with createBrowserRouter, which we don't want to
// instantiate in tests (it claims window history). Compose the same shared
// `ROUTES` array under MemoryRouter so the production tree and the test tree
// can never drift (S01 followup — previously the tests re-declared the route
// table verbatim).

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
      <MemoryRouter initialEntries={[path]}>
        <Routes>{renderRouteConfig(ROUTES)}</Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App smoke', () => {
  beforeEach(() => {
    localStorage.clear();
    void i18n.changeLanguage('uk');
  });

  it('renders the home page without crashing under the layout', () => {
    renderAt('/');
    // The layout shows the app title in header
    expect(screen.getAllByText(/HourTrack/).length).toBeGreaterThan(0);
    // S04 replaced the home placeholder with the CalendarHeader+MonthView
    // surface; we assert the calendar header mount as the route's smoke
    // signal.
    expect(screen.getByTestId('calendar-header')).toBeInTheDocument();
  });

  it('mounts /login with a localized page marker', () => {
    renderAt('/login');
    expect(screen.getByTestId('page-marker').textContent).toMatch(
      /Сторінка входу|Login page|Página de inicio/,
    );
  });

  it('mounts /settings with the S08 settings surface (no longer a placeholder)', async () => {
    renderAt('/settings');
    // S08 replaced the Settings placeholder with the real page — assert the
    // root surface mounts. Use findByTestId because the page also wires
    // TanStack Query-backed sub-sections that resolve on a microtask.
    expect(await screen.findByTestId('settings-page')).toBeInTheDocument();
  });

  it('mounts /reports with the S07 reports surface (no longer a placeholder)', () => {
    renderAt('/reports');
    expect(screen.getByTestId('reports-filters')).toBeInTheDocument();
  });

  it('mounts /day/:date with the S06 day page surface (no longer a placeholder)', async () => {
    renderAt('/day/2026-05-14');
    expect(await screen.findByTestId('day-page')).toBeInTheDocument();
  });

  it('mounts route / with the calendar surface', () => {
    renderAt('/');
    expect(screen.getByTestId('calendar-header')).toBeInTheDocument();
    expect(screen.getByTestId('month-view')).toBeInTheDocument();
  });

  it('shows localized nav labels in current language (default uk)', () => {
    renderAt('/');
    // Mobile nav and desktop nav both render the labels -- assert at least one match per label
    expect(screen.getAllByText('Календар').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Звіти').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Налаштування').length).toBeGreaterThan(0);
  });
});

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    localStorage.clear();
    void i18n.changeLanguage('uk');
  });

  it('changes locale when a different language is selected and persists to localStorage', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const switcher = screen.getByTestId('language-switcher');
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

    const switcher = screen.getByTestId('language-switcher');
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
    const switcher = screen.getByTestId('language-switcher');
    expect(switcher.textContent ?? '').toMatch(/English/);
  });
});
