import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router-dom';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { AutoBackupScheduler } from '@/features/backup/AutoBackupScheduler';
import { OnboardingProvider } from '@/features/onboarding/OnboardingProvider';

import { queryClient } from './queryClient';
import { ROUTES, type RouteConfig } from './routes';

/**
 * Convert the shared `RouteConfig` tree (also consumed by tests under
 * `MemoryRouter`) into the `RouteObject` shape expected by
 * `createBrowserRouter`. `index: true` and `path` are mutually exclusive in
 * react-router's typings, so we collapse `{ index: true, path: '/' }` into a
 * pure `{ index: true }` object before handing it over.
 */
function toRouteObject(cfg: RouteConfig): RouteObject {
  const { index, path, element, children } = cfg;
  if (index) {
    return {
      index: true,
      element,
    } satisfies RouteObject;
  }
  return {
    path,
    element,
    children: children?.map(toRouteObject),
  } as RouteObject;
}

const router = createBrowserRouter(ROUTES.map(toRouteObject));

/**
 * Composition order matters:
 *   1. QueryClientProvider -- AuthProvider uses TanStack Query for cache
 *      invalidation on signOut.
 *   2. AuthProvider        -- provides `useAuth()` to RequireAuth, LoginPage,
 *      and ProfileMenu — all of which sit inside the router tree below.
 *   3. RouterProvider      -- mounts the route tree last.
 */
export function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AutoBackupScheduler />
        <OnboardingProvider>
          <RouterProvider router={router} />
        </OnboardingProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
