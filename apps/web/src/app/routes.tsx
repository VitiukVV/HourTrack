import type { ReactElement } from 'react';

import { AppLayout } from './AppLayout';
import { ReportsRoute } from './ReportsRoute';
import { RequireAuth } from './RequireAuth';
import { LoginPage } from '@/pages/Login';
import { HomePage } from '@/pages/Home';
import { DayPage } from '@/pages/DayPage';
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
 *
 * S09 wraps the AppLayout subtree in `<RequireAuth />`, which redirects
 * unauthenticated visitors to `/login`. The `/login` route itself stays
 * outside the guard so anonymous users can actually reach the sign-in
 * surface.
 *
 * S13: `/reports` is wrapped in `<ReportsRoute />` (sibling file) which
 * lazy-imports the actual `<ReportsPage />` — Recharts bundle is
 * deferred to first navigation.
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
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, path: '/', element: <HomePage /> },
          { path: 'day/:date', element: <DayPage /> },
          { path: 'reports', element: <ReportsRoute /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
];
