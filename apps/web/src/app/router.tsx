import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router-dom';

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

export function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
