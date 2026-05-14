import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import '@/lib/i18n';
import i18n, { LANGUAGE_STORAGE_KEY } from '@/lib/i18n';
import { AppLayout } from '@/app/AppLayout';
import { HomePage } from '@/pages/Home';
import { LoginPage } from '@/pages/Login';
import { DayPage } from '@/pages/DayPage';
import { ReportsPage } from '@/pages/Reports';
import { SettingsPage } from '@/pages/Settings';

// AppRouter wraps RouterProvider with createBrowserRouter, which we don't want to
// instantiate in tests (it claims window history). Compose the same routes under
// MemoryRouter so we can drive initialEntries for per-route smoke tests.

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
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="day/:date" element={<DayPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
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
    // signal. Other routes still carry placeholder pages with
    // `data-testid="page-marker"` (see below).
    expect(screen.getByTestId('calendar-header')).toBeInTheDocument();
  });

  it.each([
    ['/login', /Сторінка входу|Login page|Página de inicio/],
    ['/day/14.05.2026', /День|Day|Día/],
    ['/reports', /Звіти|Reports|Informes/],
    ['/settings', /Налаштування|Settings|Ajustes/],
  ])('mounts route %s with a page marker', (path, pattern) => {
    renderAt(path);
    expect(screen.getByTestId('page-marker').textContent).toMatch(pattern);
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
});
