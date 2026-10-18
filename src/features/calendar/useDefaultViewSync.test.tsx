import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, initDB, updateSettings } from '@/lib/db';

import { CALENDAR_VIEW_STORAGE_KEY, useCalendarView } from './calendarStore';
import { useDefaultViewSync } from './useDefaultViewSync';

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

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function Probe() {
  useDefaultViewSync();
  const mode = useCalendarView((s) => s.mode);
  return <span data-testid="mode">{mode}</span>;
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-dvsync-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
  // Reset zustand store FIRST (this triggers a persist write), then clear
  // sessionStorage so each test starts from a clean override-less slate.
  useCalendarView.setState({ mode: 'month' });
  sessionStorage.clear();
});

afterEach(async () => {
  await testDb.delete();
  sessionStorage.clear();
});

describe('useDefaultViewSync', () => {
  it('adopts Settings.defaultView when sessionStorage has no override', async () => {
    await updateSettings(testDb, { defaultView: 'week' });
    const { getByTestId } = render(
      <Wrap>
        <Probe />
      </Wrap>,
    );
    await waitFor(() => expect(getByTestId('mode').textContent).toBe('week'));
  });

  it('does NOT overwrite the store when sessionStorage already has a key', async () => {
    sessionStorage.setItem(
      CALENDAR_VIEW_STORAGE_KEY,
      JSON.stringify({ state: { mode: 'month', anchorDate: '2026-05-14' }, version: 0 }),
    );
    await updateSettings(testDb, { defaultView: 'week' });

    const { getByTestId } = render(
      <Wrap>
        <Probe />
      </Wrap>,
    );
    // Give the effect time to (not) fire
    await new Promise((r) => setTimeout(r, 25));
    expect(getByTestId('mode').textContent).toBe('month');
  });

  it('only syncs once per mount (guard against re-runs)', async () => {
    await updateSettings(testDb, { defaultView: 'week' });
    const { getByTestId, rerender } = render(
      <Wrap>
        <Probe />
      </Wrap>,
    );
    await waitFor(() => expect(getByTestId('mode').textContent).toBe('week'));

    // User flips back to month manually mid-session.
    useCalendarView.getState().setMode('month');
    rerender(
      <Wrap>
        <Probe />
      </Wrap>,
    );
    // The hook must not re-sync from settings and clobber the user's choice.
    await new Promise((r) => setTimeout(r, 25));
    expect(getByTestId('mode').textContent).toBe('month');
  });
});
