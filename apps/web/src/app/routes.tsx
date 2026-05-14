import type { ReactElement } from 'react';

import { AppLayout } from './AppLayout';
import { LoginPage } from '@/pages/Login';
import { HomePage } from '@/pages/Home';
import { DayPage } from '@/pages/DayPage';
import { ReportsPage } from '@/pages/Reports';
import { SettingsPage } from '@/pages/Settings';

/**
 * Single source of truth for the app's route tree. Consumed by both
 * `router.tsx` (production `createBrowserRouter`) and `App.test.tsx`
 * (test-only `MemoryRouter`/`<Routes>`). Carries over the S01 followup that
 * required dropping the duplicate route definitions in tests.
 *
 * Shape is intentionally narrow — we only encode what react-router needs
 * (path, element, index, children) so the same array can be passed to
 * `createBrowserRouter` as the route objects directly OR mapped into JSX
 * `<Route>` elements inside the test renderer (see `App.test.tsx`).
 */
export interface RouteConfig {
  path?: string;
  index?: boolean;
  element: ReactElement;
  children?: RouteConfig[];
}

export const ROUTES: RouteConfig[] = [
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, path: '/', element: <HomePage /> },
      { path: 'day/:date', element: <DayPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
];
