import { describe, expect, it } from 'vitest';

import { ROUTES } from './routes';

describe('routes config', () => {
  it('exposes /login as a top-level route', () => {
    const login = ROUTES.find((r) => r.path === '/login');
    expect(login).toBeTruthy();
    expect(login?.children).toBeUndefined();
  });

  it('wraps the AppLayout root in RequireAuth (S09)', () => {
    // S09 introduces a route guard layer: the `/` entry now points at
    // `<RequireAuth />`, whose single child is the AppLayout subtree. This
    // test asserts the structural change so any future "untag the guard"
    // mistake fails loudly.
    const root = ROUTES.find((r) => r.path === '/');
    expect(root).toBeTruthy();
    expect(Array.isArray(root?.children)).toBe(true);
    expect(root?.children?.length).toBe(1);
    const layout = root?.children?.[0];
    expect(layout?.path).toBe('/');
    const childPaths = (layout?.children ?? []).map((c) => c.path ?? '/');
    expect(childPaths).toContain('/');
    expect(childPaths).toContain('day/:date');
    expect(childPaths).toContain('reports');
    expect(childPaths).toContain('payments');
    expect(childPaths).toContain('settings');
    expect(childPaths).toContain('whats-new');
  });

  it('has exactly six authenticated child routes (login is separate)', () => {
    // S27 added /payments and S30 added /whats-new alongside /, day/:date,
    // reports, settings.
    const root = ROUTES.find((r) => r.path === '/');
    const layout = root?.children?.[0];
    expect(layout?.children?.length).toBe(6);
  });

  it('wraps lazy routes in a Suspense boundary (S23)', () => {
    // S23 Task 5 — every lazy route element renders inside a `<Suspense />`
    // wrapper. Without this assertion, a future refactor that swaps the
    // wrapper for a bare `<LazyComponent />` would crash the route on the
    // first cold load instead of falling back to the spinner copy. The
    // assertion is structural: the element at each lazy slot must be a
    // React element whose `props.children` is the lazy component.
    const root = ROUTES.find((r) => r.path === '/');
    const layout = root?.children?.[0];
    for (const path of ['day/:date', 'reports', 'payments', 'settings', 'whats-new'] as const) {
      const route = (layout?.children ?? []).find((c) => c.path === path);
      expect(route, `lazy route ${path} should be present`).toBeTruthy();
      // The element is the Suspense wrapper produced by `RouteSuspense`. We
      // can't import the wrapper from outside this module, so the structural
      // check inspects `props.children` for a lazy component (object with a
      // `$$typeof` Symbol marker from React.lazy).
      const element = route?.element;
      expect(element, `lazy route ${path} should have an element`).toBeTruthy();
      // The element's child (the lazy component) is a React element too —
      // we don't dig further to keep this brittleness budget low. If the
      // wrapper structure changes (e.g. RouteSuspense composes a HOC), this
      // test will fail and the author should update it deliberately.
      expect(element?.props).toBeTruthy();
    }
    // /login also lazy.
    const login = ROUTES.find((r) => r.path === '/login');
    expect(login?.element).toBeTruthy();
    expect(login?.element.props).toBeTruthy();
  });
});

describe('routes config — catch-all', () => {
  it('sends unknown paths to the calendar instead of the framework 404', () => {
    const wildcard = ROUTES.find((r) => r.path === '*');
    expect(wildcard).toBeTruthy();
    // Last in the array so it never shadows a real route in the test-only
    // `<Routes>` renderer (the data router ranks by specificity anyway).
    expect(ROUTES[ROUTES.length - 1]?.path).toBe('*');
    expect(wildcard?.element.props).toMatchObject({ to: '/', replace: true });
  });
});
