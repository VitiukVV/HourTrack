import { lazy, Suspense } from 'react';

/**
 * Lazy-loaded `/reports` route. Recharts is ~140 kB gzipped — keeping it
 * out of the initial home-route bundle is the single biggest win in S13's
 * perf pass.
 *
 * Lives in its own file (rather than inline inside `routes.tsx`) so the
 * routes module stays a pure non-component config export — Fast Refresh
 * + react-refresh ESLint rule both flag mixed component/non-component
 * exports.
 *
 * `Suspense` fallback renders the same minimal "loading" placeholder
 * pattern Reports already shows for in-flight TanStack queries, so the
 * UX is consistent across the route-split boundary and the data-fetch
 * boundary.
 */
const ReportsPage = lazy(() => import('@/pages/Reports').then((m) => ({ default: m.ReportsPage })));

export function ReportsRoute() {
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
