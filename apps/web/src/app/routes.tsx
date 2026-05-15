import { lazy, Suspense, type ReactElement } from 'react';

import { AppLayout } from './AppLayout';
import { RequireAuth } from './RequireAuth';
import { LoginPage } from '@/pages/Login';
import { HomePage } from '@/pages/Home';
import { DayPage } from '@/pages/DayPage';
import { SettingsPage } from '@/pages/Settings';

/**
 * Lazy-loaded `/reports` route. Recharts is ~140 kB gzipped — keeping it
 * out of the initial home-route bundle is the single biggest win in S13's
 * perf pass (`pnpm build` reports the difference in the journal entry).
 *
 * `Suspense` fallback renders the same minimal "loading" placeholder
 * pattern Reports already shows for in-flight TanStack queries, so the
 * UX is consistent across the route-split boundary and the data-fetch
 * boundary.
 */
const ReportsPage = lazy(() => import('@/pages/Reports').then((m) => ({ default: m.ReportsPage })));

function ReportsRoute() {
  return (
    <Suspense
      fallback={
        <p className="text-muted-foreground text-sm" data-testid="reports-route-loading">
          Loading...
        </p>
      }
    >
      <ReportsPage />
    </Suspense>
  );
}

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
