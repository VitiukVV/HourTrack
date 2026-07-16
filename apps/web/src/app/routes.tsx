/* eslint-disable react-refresh/only-export-components --
 * This file is the route-tree source of truth, NOT a typical component
 * file. It exports both a config constant (`ROUTES`) and tiny in-module
 * components (`RouteSuspense`/`RouteFallback`) that are structurally part
 * of the routing contract. Splitting the components into a separate file
 * just to satisfy the fast-refresh heuristic fragments responsibility.
 */
import { lazy, Suspense, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { AppLayout } from './AppLayout';
import { RequireAuth } from './RequireAuth';
import { ErrorScreen } from './ErrorScreen';
import { HomePage } from '@/pages/Home';

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
 * S23 — `LoginPage`, `ReportsPage`, `SettingsPage`, and `DayPage` are all
 * `React.lazy`. The eager Home route stays eager: `/` is the cold-start
 * surface for the authed user and lazy-loading it would only add a Suspense
 * round-trip before first paint. The lazy split shrinks the index chunk by
 * deferring code that doesn't run on `/`:
 *   - LoginPage   → Google Identity Services helper + login copy
 *   - ReportsPage → DayPicker / MonthPicker / WeekPicker, computeReport,
 *                   ReportsTable / ReportsFilters / ReportsMetrics
 *   - SettingsPage → BackupSection → restoreFlow + validateSnapshot
 *                   (whole restore stack), every Settings subsection
 *   - DayPage     → `react-virtuoso` (~30 KB transitively), EntryEditor,
 *                   per-card history hooks
 *
 * The S13 comment in `vite.config.ts:36-42` is load-bearing: do NOT split
 * `@tanstack/react-query` into its own manualChunks entry. Lazy routes
 * cross module boundaries; Rollup might otherwise dedupe TanStack into a
 * separate chunk and break the QueryClient singleton.
 */
export interface RouteConfig {
  path?: string;
  index?: boolean;
  element: ReactElement;
  children?: RouteConfig[];
  /**
   * S29 Task 10 — react-router `errorElement`. Set on the root route so a
   * render/loader error inside the routed tree shows the localized ErrorScreen
   * instead of react-router's default framework error page. Ignored by the
   * test-only `<Routes>` renderer (data-router-only feature).
   */
  errorElement?: ReactElement;
}

/**
 * Shared Suspense fallback used by every lazy route. Renders the same
 * "Завантаження..." spinner copy as `RequireAuth`'s loading state so the
 * user sees a consistent affordance across login redirects and lazy-chunk
 * fetches.
 *
 * Kept centralised inside this module (rather than a separate component
 * file) because the fallback is structurally part of the route tree's
 * lazy-boundary contract — moving it elsewhere fragments the responsibility.
 */
function RouteSuspense({ children }: { children: ReactElement }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="route-suspense-fallback"
      className="flex min-h-dvh items-center justify-center"
    >
      <span className="text-muted-foreground text-sm">{t('common.loading')}</span>
    </div>
  );
}

// Lazy-loaded route components. Each chunk lands in its own file via
// Rollup's default code-splitting heuristics. The `.then` adapter is needed
// because our pages are exported as named bindings, not default exports.
const LoginPage = lazy(() => import('@/pages/Login').then((m) => ({ default: m.LoginPage })));
const ReportsPage = lazy(() => import('@/pages/Reports').then((m) => ({ default: m.ReportsPage })));
const PaymentsPage = lazy(() =>
  import('@/pages/Payments').then((m) => ({ default: m.PaymentsPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/Settings').then((m) => ({ default: m.SettingsPage })),
);
const DayPage = lazy(() => import('@/pages/DayPage').then((m) => ({ default: m.DayPage })));

export const ROUTES: RouteConfig[] = [
  {
    path: '/login',
    element: (
      <RouteSuspense>
        <LoginPage />
      </RouteSuspense>
    ),
  },
  {
    path: '/',
    element: <RequireAuth />,
    errorElement: <ErrorScreen />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, path: '/', element: <HomePage /> },
          {
            path: 'day/:date',
            element: (
              <RouteSuspense>
                <DayPage />
              </RouteSuspense>
            ),
          },
          {
            path: 'reports',
            element: (
              <RouteSuspense>
                <ReportsPage />
              </RouteSuspense>
            ),
          },
          {
            path: 'payments',
            element: (
              <RouteSuspense>
                <PaymentsPage />
              </RouteSuspense>
            ),
          },
          {
            path: 'settings',
            element: (
              <RouteSuspense>
                <SettingsPage />
              </RouteSuspense>
            ),
          },
        ],
      },
    ],
  },
];
