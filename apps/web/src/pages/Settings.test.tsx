import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';
import type * as dbModule from '@/lib/db';
import { HourTrackDB, initDB } from '@/lib/db';

import { SettingsPage } from './Settings';

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
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-settings-page-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('SettingsPage', () => {
  it('renders all six sections', async () => {
    render(
      <Wrap>
        <SettingsPage />
      </Wrap>,
    );

    expect(await screen.findByTestId('settings-page')).toBeInTheDocument();
    expect(screen.getByTestId('settings-profile')).toBeInTheDocument();
    expect(screen.getByTestId('settings-interface')).toBeInTheDocument();
    expect(screen.getByTestId('settings-data')).toBeInTheDocument();
    expect(screen.getByTestId('settings-archive')).toBeInTheDocument();
    expect(screen.getByTestId('settings-calendar')).toBeInTheDocument();
    expect(screen.getByTestId('settings-about')).toBeInTheDocument();
  });

  it('renders the about version slot (falls back to dev in tests)', async () => {
    render(
      <Wrap>
        <SettingsPage />
      </Wrap>,
    );
    const v = await screen.findByTestId('settings-about-version');
    // Vite `define` doesn't fire in Vitest runs, so the fallback string surfaces.
    expect(v.textContent).toMatch(/dev|\d/);
  });
});
