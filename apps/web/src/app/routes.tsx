/* eslint-disable react-refresh/only-export-components --
 * This file is the route-tree source of truth, NOT a typical component
 * file. It exports both a config constant (`ROUTES`) and tiny in-module
 * components (`RouteSuspense`/`RouteFallback`) that are structurally part
 * of the routing contract. Splitting the components into a separate file
 * just to satisfy the fast-refresh heuristic fragments responsibility.
 */
import { lazy, Suspense, type ComponentType, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { AppLayout } from './AppLayout';
import { RequireAuth } from './RequireAuth';
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
// Rollup's default code-splitting heuristics.
//
// Pattern: `React.lazy(() => import('@/pages/X').then(m => ({ default: m.X })))`
// because our pages are exported as NAMED bindings (e.g. `export function
// LoginPage`), not default exports. The `.then` wrapper adapts the named
// export to the default-export shape React.lazy expects.
function lazyNamed<T extends ComponentType<unknown>>(
  loader: () => Promise<Record<string, ComponentType<unknown>>>,
  exportName: string,
): T {
  return lazy(async () => {
    const mod = await loader();
    const Comp = mod[exportName];
    if (!Comp) {
      throw new Error(`Lazy route loader: module is missing export "${exportName}"`);
    }
    return { default: Comp };
  }) as unknown as T;
}

const LoginPage = lazyNamed(() => import('@/pages/Login'), 'LoginPage');
const ReportsPage = lazyNamed(() => import('@/pages/Reports'), 'ReportsPage');
const SettingsPage = lazyNamed(() => import('@/pages/Settings'), 'SettingsPage');
const DayPage = lazyNamed(() => import('@/pages/DayPage'), 'DayPage');

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
