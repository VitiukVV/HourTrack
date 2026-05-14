import { describe, expect, it } from 'vitest';

import { ROUTES } from './routes';

describe('routes config', () => {
  it('exposes /login as a top-level route', () => {
    const login = ROUTES.find((r) => r.path === '/login');
    expect(login).toBeTruthy();
    expect(login?.children).toBeUndefined();
  });

  it('exposes the AppLayout root with child routes', () => {
    const root = ROUTES.find((r) => r.path === '/');
    expect(root).toBeTruthy();
    expect(Array.isArray(root?.children)).toBe(true);
    const childPaths = (root?.children ?? []).map((c) => c.path ?? '/');
    expect(childPaths).toContain('/');
    expect(childPaths).toContain('day/:date');
    expect(childPaths).toContain('reports');
    expect(childPaths).toContain('settings');
  });

  it('has exactly four authenticated child routes (login is separate)', () => {
    const root = ROUTES.find((r) => r.path === '/');
    expect(root?.children?.length).toBe(4);
  });
});
