import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, createEntry, initDB } from '@/lib/db';
import type { Card, Entry } from '@hourtrack/shared-types';

import { WeekView } from './WeekView';
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
    color: '#3B82F6',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
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

function renderWeek() {
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
  return render(<WeekView />, { wrapper: Wrapper });
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-weekview-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
  sessionStorage.clear();
  // 2026-05-14 is a Thursday → week is Mon 11 – Sun 17 May.
  useCalendarView.setState({ mode: 'week', anchorDate: '2026-05-14' });
});

afterEach(async () => {
  await testDb.delete();
  sessionStorage.clear();
});

describe('WeekView', () => {
  it('renders 7 day columns Mon..Sun', async () => {
    renderWeek();
    const cols = await screen.findAllByTestId(/^week-day-/);
    expect(cols).toHaveLength(7);
    expect(cols[0]?.getAttribute('data-testid')).toBe('week-day-2026-05-11');
    expect(cols[6]?.getAttribute('data-testid')).toBe('week-day-2026-05-17');
  });

  it('renders all entries in a day inline (no truncation)', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Heavy' }));
    for (let i = 0; i < 6; i++) {
      await createEntry(testDb, makeEntryInput(card.id, '2026-05-12'));
    }
    renderWeek();
    const col = await screen.findByTestId('week-day-2026-05-12');
    await waitFor(() => {
      expect(col.querySelectorAll('[data-testid="entry-chip"]').length).toBe(6);
    });
  });

  it('shows a note marker on entries with notes', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Noted' }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-13', { note: 'memo' }));
    renderWeek();
    const col = await screen.findByTestId('week-day-2026-05-13');
    await waitFor(() => {
      expect(col.querySelector('[data-testid="note-marker"]')).not.toBeNull();
    });
  });

  it('renders DD.MM in column headers', async () => {
    renderWeek();
    const col = await screen.findByTestId('week-day-2026-05-11');
    expect(col.textContent).toMatch(/11\.05/);
  });
});
