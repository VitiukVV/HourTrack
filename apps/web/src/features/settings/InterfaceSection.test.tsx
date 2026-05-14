import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';
import type * as dbModule from '@/lib/db';
import { HourTrackDB, initDB } from '@/lib/db';

import { InterfaceSection } from './InterfaceSection';

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

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-iface-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('InterfaceSection', () => {
  it('renders three controls: language, theme, default view', async () => {
    render(
      <Wrap>
        <InterfaceSection />
      </Wrap>,
    );
    expect(await screen.findByTestId('settings-interface-language')).toBeInTheDocument();
    expect(screen.getByTestId('settings-interface-theme')).toBeInTheDocument();
    expect(screen.getByTestId('settings-interface-default-view')).toBeInTheDocument();
  });

  it('updates theme in Settings when a theme button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <Wrap>
        <InterfaceSection />
      </Wrap>,
    );
    const themeGroup = await screen.findByTestId('settings-interface-theme');
    // dark button labelled by aria-label
    const darkBtn = themeGroup.querySelector<HTMLButtonElement>('[data-value="dark"]');
    expect(darkBtn).toBeTruthy();
    await user.click(darkBtn as HTMLButtonElement);

    await waitFor(async () => {
      const row = await testDb.settings.get('current');
      expect(row?.theme).toBe('dark');
    });
  });

  it('updates defaultView in Settings when week is picked', async () => {
    const user = userEvent.setup();
    render(
      <Wrap>
        <InterfaceSection />
      </Wrap>,
    );
    const viewGroup = await screen.findByTestId('settings-interface-default-view');
    const weekBtn = viewGroup.querySelector<HTMLButtonElement>('[data-value="week"]');
    expect(weekBtn).toBeTruthy();
    await user.click(weekBtn as HTMLButtonElement);

    await waitFor(async () => {
      const row = await testDb.settings.get('current');
      expect(row?.defaultView).toBe('week');
    });
  });
});
