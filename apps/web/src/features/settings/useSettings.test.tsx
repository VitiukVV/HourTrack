import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, initDB } from '@/lib/db';

import { useSettingsQuery, useUpdateSettingsMutation } from './useSettings';

let testDb: HourTrackDB;

type DbModule = typeof dbModule;

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<DbModule>();
  return {
    ...actual,
    get db() {
      return testDb;
    },
  };
});

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-settings-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('useSettingsQuery', () => {
  it('returns the seeded Settings row', async () => {
    const { result } = renderHook(() => useSettingsQuery(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data;
    expect(data).toBeTruthy();
    expect(data?.theme).toBe('system');
    expect(data?.defaultView).toBe('month');
  });
});

describe('useUpdateSettingsMutation', () => {
  it('patches the Settings row and invalidates the query', async () => {
    const Wrap = wrapper();
    const { result } = renderHook(
      () => {
        const q = useSettingsQuery();
        const m = useUpdateSettingsMutation();
        return { q, m };
      },
      { wrapper: Wrap },
    );

    await waitFor(() => expect(result.current.q.isSuccess).toBe(true));
    await result.current.m.mutateAsync({ theme: 'dark' });

    // After mutation, the cache should have refreshed with the new theme.
    await waitFor(() => expect(result.current.q.data?.theme).toBe('dark'));
  });

  it('persists writes across query renders', async () => {
    const Wrap = wrapper();
    const { result } = renderHook(
      () => {
        const q = useSettingsQuery();
        const m = useUpdateSettingsMutation();
        return { q, m };
      },
      { wrapper: Wrap },
    );

    await waitFor(() => expect(result.current.q.isSuccess).toBe(true));
    await result.current.m.mutateAsync({ defaultView: 'week' });

    await waitFor(() => expect(result.current.q.data?.defaultView).toBe('week'));
  });
});
