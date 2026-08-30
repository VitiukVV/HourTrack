import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card } from '@hourtrack/shared-types';
import { formatLocalDate, startOfMonth, startOfWeekMonday } from '@hourtrack/shared-utils';

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
    color: '#2563EB',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    monthlyTotal: null,
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

    // The MonthPicker trigger also has `aria-label="Month"`, so we scope
    // the period preset queries to the presets row to avoid the
    // multiple-matches error.
    const presets = within(screen.getByTestId('reports-filters-presets-row'));
    expect(presets.getByRole('button', { name: /^day$/i })).toBeInTheDocument();
    expect(presets.getByRole('button', { name: /^week$/i })).toBeInTheDocument();
    const monthBtn = presets.getByRole('button', { name: /^month$/i });
    expect(monthBtn).toBeInTheDocument();
    expect(presets.getByRole('button', { name: /^custom$/i })).toBeInTheDocument();

    // Active month preset gets aria-pressed=true
    expect(monthBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking a period button updates the store and snaps anchorDate', async () => {
    const user = userEvent.setup();
    renderFilters();
    await user.click(screen.getByRole('button', { name: /^week$/i }));
    expect(useReportsFilters.getState().period).toBe('week');
    expect(useReportsFilters.getState().anchorDate).toBe(
      formatLocalDate(startOfWeekMonday(new Date())),
    );

    await user.click(screen.getByRole('button', { name: /^custom$/i }));
    expect(useReportsFilters.getState().period).toBe('custom');
  });

  // S20 (Task 4 / UR-20-5) — month preset → MonthPicker
  it('month period renders the MonthPicker (not a native date input)', async () => {
    renderFilters();
    expect(screen.getByTestId('month-picker-trigger')).toBeInTheDocument();
  });

  // S20 (Task 4 / UR-20-6) — week preset → WeekPicker
  it('week period renders the WeekPicker (not a native date input)', async () => {
    const user = userEvent.setup();
    renderFilters();
    await user.click(screen.getByRole('button', { name: /^week$/i }));
    expect(screen.getByTestId('week-picker-trigger')).toBeInTheDocument();
  });

  // Day preset renders the shared DayPicker (matching MonthPicker /
  // WeekPicker styling). The native `<input type="date">` was swapped out
  // so all three modes share one visual shell.
  it('day period renders the DayPicker (not a native date input)', async () => {
    const user = userEvent.setup();
    renderFilters();
    await user.click(screen.getByRole('button', { name: /^day$/i }));
    expect(screen.getByTestId('day-picker-trigger')).toBeInTheDocument();
  });

  // S20 (Task 8 / UR-20-4) — duplicate readable-date span is gone
  it('does NOT render the legacy anchor-readable duplicate-date span', () => {
    renderFilters();
    expect(screen.queryByTestId('anchor-readable')).not.toBeInTheDocument();
  });

  // S20 (Task 15 / UR-20-10) — section split: sticky vs scrollable
  it('renders sticky Section 1 + non-sticky Section 2 (chip-row scrolls away)', () => {
    renderFilters();
    const sticky = screen.getByTestId('reports-filters-section-sticky');
    expect(sticky.className).toMatch(/sticky/);
    // The offset is no longer `top-0` (which pinned the bar behind the opaque
    // chrome header) — it comes from the chrome height AppLayout measures.
    expect(sticky.className).toContain('top-[var(--ht-sticky-chrome,0px)]');

    const scrollable = screen.getByTestId('reports-filters-section-scrollable');
    expect(scrollable.className).not.toMatch(/\bsticky\b/);
  });

  // S20 (Task 13 / UR-20-9) — presets row is single-line + horizontally scrollable
  it('presets row is `flex-nowrap` with horizontal overflow', () => {
    renderFilters();
    const row = screen.getByTestId('reports-filters-presets-row');
    expect(row.className).toMatch(/flex-nowrap/);
    expect(row.className).toMatch(/overflow-x-auto/);
  });

  // S20 (Task 9) — Reset button is destructive variant
  it('Reset button uses the destructive variant', () => {
    renderFilters();
    const reset = screen.getByTestId('reports-filters-reset');
    expect(reset.className).toMatch(/bg-destructive/);
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

  // "Reset cards" button is always visible — default = all selected (null),
  // pressing reset returns to that state from any narrowing.
  it('"Reset cards" button is visible by default (no narrowing)', async () => {
    await createCard(testDb, makeCardInput({ name: 'A' }));
    renderFilters();
    await waitFor(() => expect(screen.getByRole('button', { name: /^A$/ })).toBeInTheDocument());
    expect(screen.getByTestId('reports-filters-reset-cards')).toBeInTheDocument();
  });

  it('"Reset cards" unselects every card (selectedCardIds → []) and stays visible', async () => {
    // Use deterministic IDs so the assertion can compare arrays directly.
    await createCard(testDb, makeCardInput({ id: 'card-a', name: 'A' }));
    await createCard(testDb, makeCardInput({ id: 'card-b', name: 'B' }));

    const user = userEvent.setup();
    renderFilters();
    await waitFor(() => expect(screen.getByRole('button', { name: /^A$/ })).toBeInTheDocument());

    // Toggle A off → selectedCardIds becomes ['card-b'] → reset still visible.
    await user.click(screen.getByRole('button', { name: /^A$/ }));
    expect(useReportsFilters.getState().selectedCardIds).toEqual(['card-b']);
    const resetCards = screen.getByTestId('reports-filters-reset-cards');
    expect(resetCards).toBeInTheDocument();

    await user.click(resetCards);
    // Reset DROPS all active cards — explicit empty selection, not the
    // "follow all active cards" null sentinel.
    expect(useReportsFilters.getState().selectedCardIds).toEqual([]);
    // Still present after reset — it's a permanent affordance now.
    expect(screen.getByTestId('reports-filters-reset-cards')).toBeInTheDocument();
  });

  // S20 (Task 9/10) — Reset returns to month + startOfMonth(today) + null cards.
  it('Reset restores S20 defaults', async () => {
    const user = userEvent.setup();
    renderFilters();

    await user.click(screen.getByRole('button', { name: /^week$/i }));
    expect(useReportsFilters.getState().period).toBe('week');

    await user.click(screen.getByTestId('reports-filters-reset'));
    expect(useReportsFilters.getState().period).toBe('month');
    expect(useReportsFilters.getState().anchorDate).toBe(formatLocalDate(startOfMonth(new Date())));
    expect(useReportsFilters.getState().selectedCardIds).toBeNull();
    expect(useReportsFilters.getState().showArchived).toBe(false);
  });
});
