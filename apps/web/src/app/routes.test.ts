import { describe, expect, it } from 'vitest';

import { ReportsPage } from '@/pages/Reports';

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
    expect(childPaths).toContain('settings');
  });

  it('has exactly four authenticated child routes (login is separate)', () => {
    const root = ROUTES.find((r) => r.path === '/');
    const layout = root?.children?.[0];
    expect(layout?.children?.length).toBe(4);
  });

  it('mounts /reports as a direct <ReportsPage /> import (no lazy boundary)', () => {
    // S13 wrapped /reports in a lazy <ReportsRoute /> to defer Recharts.
    // S15 removed Recharts and inlined the import — guard against a future
    // regression that reintroduces an unjustified lazy boundary.
    const root = ROUTES.find((r) => r.path === '/');
    const layout = root?.children?.[0];
    const reportsRoute = (layout?.children ?? []).find((c) => c.path === 'reports');
    expect(reportsRoute).toBeTruthy();
    expect(reportsRoute?.element.type).toBe(ReportsPage);
  });
});
