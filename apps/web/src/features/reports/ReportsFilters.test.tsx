import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card } from '@hourtrack/shared-types';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, initDB } from '@/lib/db';
import '@/lib/i18n';

import { ReportsFilters } from './ReportsFilters';
import { useReportsFilters } from './reportsStore';

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

function makeCardInput(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Card',
    color: '#3B82F6',
    defaultDurationMin: 480,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    ...overrides,
  };
}

function renderFilters() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ReportsFilters />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-reports-filters-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
  useReportsFilters.getState().reset();
});

afterEach(async () => {
  await testDb.delete();
});

describe('ReportsFilters', () => {
  it('renders the four period preset buttons and highlights Month by default', async () => {
    renderFilters();

    expect(screen.getByRole('button', { name: /day/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /week/i })).toBeInTheDocument();
    const monthBtn = screen.getByRole('button', { name: /month/i });
    expect(monthBtn).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /custom/i })).toBeInTheDocument();

    // Active month button gets aria-pressed=true
    expect(monthBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking a period button updates the store', async () => {
    const user = userEvent.setup();
    renderFilters();
    await user.click(screen.getByRole('button', { name: /week/i }));
    expect(useReportsFilters.getState().period).toBe('week');

    await user.click(screen.getByRole('button', { name: /custom/i }));
    expect(useReportsFilters.getState().period).toBe('custom');
  });

  it('renders one card chip per active card and starts with all selected', async () => {
    await createCard(testDb, makeCardInput({ name: 'A' }));
    await createCard(testDb, makeCardInput({ name: 'B' }));

    renderFilters();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^A$/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^B$/ })).toBeInTheDocument();
    });
    // All selected by default — both chips show aria-pressed=true
    expect(screen.getByRole('button', { name: /^A$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^B$/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking a card chip toggles it off then on', async () => {
    await createCard(testDb, makeCardInput({ name: 'A' }));
    await createCard(testDb, makeCardInput({ name: 'B' }));

    const user = userEvent.setup();
    renderFilters();
    await waitFor(() => expect(screen.getByRole('button', { name: /^A$/ })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^A$/ }));
    expect(screen.getByRole('button', { name: /^A$/ })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: /^A$/ }));
    expect(screen.getByRole('button', { name: /^A$/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"Show archived" toggle reveals archived cards in the multi-select', async () => {
    await createCard(testDb, makeCardInput({ name: 'Active' }));
    await createCard(
      testDb,
      makeCardInput({ name: 'Old', isArchived: true, archivedAt: '2026-01-01' }),
    );

    const user = userEvent.setup();
    renderFilters();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Active$/ })).toBeInTheDocument(),
    );

    // Old not visible initially
    expect(screen.queryByRole('button', { name: /^Old$/ })).not.toBeInTheDocument();

    const toggle = screen.getByRole('switch');
    await user.click(toggle);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Old$/ })).toBeInTheDocument());
  });

  it('Reset button restores defaults', async () => {
    const user = userEvent.setup();
    renderFilters();

    await user.click(screen.getByRole('button', { name: /week/i }));
    expect(useReportsFilters.getState().period).toBe('week');

    await user.click(screen.getByRole('button', { name: /reset/i }));
    expect(useReportsFilters.getState().period).toBe('month');
  });
});
