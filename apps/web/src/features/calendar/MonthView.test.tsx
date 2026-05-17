import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, createEntry, initDB } from '@/lib/db';
import type { Card, Entry } from '@hourtrack/shared-types';

import { useActiveCardStore } from '@/features/cards/useActiveCardStore';

import { MonthView } from './MonthView';
import { useCalendarView } from './calendarStore';

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

function makeEntryInput(
  cardId: string,
  date: string,
  overrides: Partial<Entry> = {},
): Omit<Entry, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    cardId,
    date,
    startMinutes: 600,
    durationMin: 120,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    ...overrides,
  };
}

function renderMonth() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<MonthView />, { wrapper: Wrapper });
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-monthview-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
  sessionStorage.clear();
  useActiveCardStore.getState().clearActive();
  // 2026-05-14 is a Thursday in May 2026. Grid is 27 Apr - 31 May = 35 cells.
  useCalendarView.setState({ mode: 'month', anchorDate: '2026-05-14' });
});

afterEach(async () => {
  await testDb.delete();
  sessionStorage.clear();
  useActiveCardStore.getState().clearActive();
});

describe('MonthView', () => {
  it('renders 7 weekday header cells (Mon..Sun)', async () => {
    renderMonth();
    // The weekday strip is a `<header>` containing 7 plain `<div>` cells.
    // We previously tagged each with `role="columnheader"` but axe-core
    // flagged it as `aria-required-parent` (no enclosing grid/table), so
    // the roles were dropped in S13. Query by the header's children instead.
    const header = (await screen.findByTestId('month-view')).querySelector('header');
    expect(header).not.toBeNull();
    expect(header!.children).toHaveLength(7);
    // Wait for the deferred entries query to settle so no state update lands
    // after the test ends (avoids the act() warning).
    await waitFor(() => expect(screen.queryAllByTestId(/^day-cell-/).length).toBeGreaterThan(0));
  });

  it('renders a 35- or 42-cell grid starting on Monday', async () => {
    renderMonth();
    const cells = await screen.findAllByTestId(/^day-cell-/);
    // May 2026: Fri 1 May → Sun 31 May → grid = Mon 27 Apr → Sun 31 May = 35 cells
    expect(cells.length).toBeGreaterThanOrEqual(35);
    expect(cells.length).toBeLessThanOrEqual(42);
    // First cell should be Monday April 27, 2026.
    expect(cells[0]?.getAttribute('data-testid')).toBe('day-cell-2026-04-27');
  });

  it('fades day cells outside the current month', async () => {
    renderMonth();
    const outsideCell = await screen.findByTestId('day-cell-2026-04-27');
    // Outside-month cells render with a muted bg + 60% opacity (was 50%
    // before — bumped slightly when the explicit `bg-muted/30` tint was
    // added on top so the cell stayed distinguishable on the new
    // gap-px-painted grid). Match the canonical attribute the parent
    // queries rely on instead of the opacity utility class.
    expect(outsideCell.getAttribute('data-current-month')).toBe('false');
    expect(outsideCell.className).toMatch(/opacity-60/);
    const insideCell = screen.getByTestId('day-cell-2026-05-14');
    expect(insideCell.getAttribute('data-current-month')).toBe('true');
    expect(insideCell.className).not.toMatch(/opacity-/);
  });

  it('renders up to 3 entry chips and a +N more link when there are more', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'CardA' }));
    // 5 entries on the same day → 3 chips + "+2 more"
    for (let i = 0; i < 5; i++) {
      await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));
    }
    renderMonth();
    const cell = await screen.findByTestId('day-cell-2026-05-14');
    await waitFor(() => {
      expect(cell.querySelectorAll('[data-testid="entry-chip"]').length).toBe(3);
    });
    expect(cell.textContent).toMatch(/\+2/);
  });

  it('shows a note marker when any entry on the day has a non-null note', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'NoteCard' }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-15', { note: 'remember' }));
    renderMonth();
    const cell = await screen.findByTestId('day-cell-2026-05-15');
    await waitFor(() => {
      expect(cell.querySelector('[data-testid="note-marker"]')).not.toBeNull();
    });
  });

  it('hides the note marker on days where no entry has a note', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Plain' }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-16', { note: null }));
    renderMonth();
    const cell = await screen.findByTestId('day-cell-2026-05-16');
    await waitFor(() => {
      expect(cell.querySelectorAll('[data-testid="entry-chip"]').length).toBe(1);
    });
    expect(cell.querySelector('[data-testid="note-marker"]')).toBeNull();
  });

  // S21 (UR-21-2): the per-day duration/EUR footer was REMOVED. The
  // prior "renders a totals footer with formatted duration and EUR
  // earnings" assertion is gone. DayCell.test.tsx asserts the absence
  // explicitly via the "S21 footer removal (UR-21-2)" describe block.

  it('marks today with a today modifier', async () => {
    // Snap anchor to today so the today modifier is applied to a cell present
    // in the grid. Use LOCAL date components — MonthView's internal `today`
    // reference (new Date()) is in local time, so `toISOString().slice(0,10)`
    // (which is UTC) would mismatch in timezones where local + UTC straddle
    // midnight.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    useCalendarView.setState({ mode: 'month', anchorDate: today });
    renderMonth();
    const todayCell = await screen.findByTestId(`day-cell-${today}`);
    expect(todayCell.getAttribute('data-today')).toBe('true');
  });

  it('day cell wrapper is NOT a role="button" (S04 W1 fix — avoid nested-interactive HTML)', async () => {
    renderMonth();
    const cell = await screen.findByTestId('day-cell-2026-05-14');
    // Must remain keyboard-focusable but NOT advertise role="button" (would
    // nest with the future +N-more link button and the entry chips).
    expect(cell.getAttribute('role')).not.toBe('button');
    // It should still be tab-reachable so keyboard users can press Enter.
    expect(cell.getAttribute('tabIndex') ?? cell.getAttribute('tabindex')).toBe('0');
  });

  it('clicking an empty day with an active card creates an entry for that card on that date', async () => {
    const card = await createCard(
      testDb,
      makeCardInput({ name: 'Active', defaultDurationMin: 90 }),
    );
    useActiveCardStore.getState().setActiveCardId(card.id);

    renderMonth();
    const cell = await screen.findByTestId('day-cell-2026-05-14');
    // Make sure the chip query has settled (no entries) before clicking.
    await waitFor(() => {
      expect(cell.querySelectorAll('[data-testid="entry-chip"]').length).toBe(0);
    });

    const user = userEvent.setup();
    await user.click(cell);

    // userEvent.click already wraps in act(); the create-entry mutation
    // resolves asynchronously after the click, so we waitFor the DB write to
    // propagate through TanStack Query invalidation into the UI. The S05
    // followup #4 was applied to the act() pattern but turned out to conflict
    // with userEvent's internal act handling — the waitFor below is the
    // correct flake-free signal.
    await waitFor(() => {
      expect(cell.querySelectorAll('[data-testid="entry-chip"]').length).toBe(1);
    });
  });
});
