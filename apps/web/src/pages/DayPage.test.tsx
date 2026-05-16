import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, createEntry, initDB } from '@/lib/db';
import type { Card, Entry } from '@hourtrack/shared-types';

import { DayPage } from './DayPage';

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

function renderDayPage(initialUrl: string) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route path="/" element={<div data-testid="home-stub">HOME</div>} />
            <Route path="/day/:date" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<DayPage />, { wrapper: Wrapper });
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-day-page-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('DayPage routing', () => {
  it('redirects to / when :date is not a valid YYYY-MM-DD', async () => {
    renderDayPage('/day/not-a-date');
    expect(await screen.findByTestId('home-stub')).toBeInTheDocument();
  });

  it('redirects to / when :date is missing', async () => {
    renderDayPage('/day/');
    // /day/ without a trailing segment doesn't match /day/:date — it lands on home anyway
    // but we still verify the page never renders for missing dates.
    expect(screen.queryByTestId('day-page')).not.toBeInTheDocument();
  });

  it('renders the page for a valid YYYY-MM-DD route param', async () => {
    renderDayPage('/day/2026-05-14');
    expect(await screen.findByTestId('day-page')).toBeInTheDocument();
  });
});

describe('DayPage content', () => {
  it('renders the localized weekday + DD.MM.YYYY date in the title', async () => {
    renderDayPage('/day/2026-05-14');
    // 2026-05-14 is a Thursday
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(/Thursday|Четвер|jueves/i);
    expect(heading.textContent).toMatch(/14\.05\.2026/);
  });

  it('lists every entry for the date as an EntryEditor row (no truncation)', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Multi' }));
    for (let i = 0; i < 5; i++) {
      await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));
    }

    renderDayPage('/day/2026-05-14');

    await waitFor(() => {
      expect(screen.getAllByTestId('entry-editor')).toHaveLength(5);
    });
  });

  it('shows an empty state when the day has no entries', async () => {
    renderDayPage('/day/2026-05-14');

    expect(await screen.findByTestId('day-page-empty')).toBeInTheDocument();
  });

  it('renders day total in {H}H {M}M format and EUR earnings', async () => {
    const card = await createCard(
      testDb,
      makeCardInput({ name: 'Tot', rateType: 'hourly', hourlyRate: 30 }),
    );
    // 60 + 120 = 180min = 3H 0M; 3h × 30 = 90.00 EUR
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-14', { durationMin: 60 }));
    await createEntry(testDb, makeEntryInput(card.id, '2026-05-14', { durationMin: 120 }));

    renderDayPage('/day/2026-05-14');

    await waitFor(() => {
      const total = screen.getByTestId('day-page-total');
      expect(total.textContent).toMatch(/3H 0M/);
      expect(total.textContent).toMatch(/90\.00/);
    });
  });
});

describe('DayPage navigation', () => {
  it('Previous day button navigates to the day before', async () => {
    renderDayPage('/day/2026-05-14');
    const user = userEvent.setup();
    const prev = await screen.findByRole('link', { name: /previous day/i });
    expect(prev.getAttribute('href')).toBe('/day/2026-05-13');
    await user.click(prev);
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(/13\.05\.2026/);
  });

  it('Next day button navigates to the day after', async () => {
    renderDayPage('/day/2026-05-14');
    const next = await screen.findByRole('link', { name: /next day/i });
    expect(next.getAttribute('href')).toBe('/day/2026-05-15');
  });

  it('Previous day crosses month boundary correctly', async () => {
    renderDayPage('/day/2026-06-01');
    const prev = await screen.findByRole('link', { name: /previous day/i });
    expect(prev.getAttribute('href')).toBe('/day/2026-05-31');
  });

  it('Next day crosses year boundary correctly', async () => {
    renderDayPage('/day/2026-12-31');
    const next = await screen.findByRole('link', { name: /next day/i });
    expect(next.getAttribute('href')).toBe('/day/2027-01-01');
  });

  it('Back to calendar links to /', async () => {
    renderDayPage('/day/2026-05-14');
    const back = await screen.findByRole('link', { name: /back to calendar/i });
    expect(back.getAttribute('href')).toBe('/');
  });
});

describe('DayPage Add Entry flow', () => {
  it('+ Add entry button opens the DayPickerModal', async () => {
    await createCard(testDb, makeCardInput({ name: 'Pickable' }));

    renderDayPage('/day/2026-05-14');
    const user = userEvent.setup();

    const addBtn = await screen.findByRole('button', { name: /\+ add entry to this day/i });
    await user.click(addBtn);

    // DayPickerModal renders a dialog with the existing entries.dayPicker.title key.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Pickable/)).toBeInTheDocument();
  });

  it('Picking a card creates an entry visible on the page', async () => {
    await createCard(testDb, makeCardInput({ name: 'NewOne' }));

    renderDayPage('/day/2026-05-14');
    const user = userEvent.setup();

    const addBtn = await screen.findByRole('button', { name: /\+ add entry to this day/i });
    await user.click(addBtn);

    const cardButton = await screen.findByRole('button', { name: /NewOne/ });
    await user.click(cardButton);

    await waitFor(() => {
      expect(screen.getAllByTestId('entry-editor')).toHaveLength(1);
    });
  });

  // S16b — verifies `DayPage.handlePick` copies card.defaultStartMinutes
  // onto the new entry, matching the second `useCreateEntryMutation` call
  // site behaviour from `useDayClickFlow`.
  it('+ Add entry prefills entry.startMinutes from card.defaultStartMinutes (10:00 → 600)', async () => {
    await createCard(
      testDb,
      makeCardInput({ name: 'Prefill', defaultStartMinutes: 600 }), // 10:00
    );

    renderDayPage('/day/2026-05-14');
    const user = userEvent.setup();

    const addBtn = await screen.findByRole('button', { name: /\+ add entry to this day/i });
    await user.click(addBtn);

    const cardButton = await screen.findByRole('button', { name: /Prefill/ });
    await user.click(cardButton);

    await waitFor(async () => {
      const entries = await testDb.entries.toArray();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.startMinutes).toBe(600);
    });
  });
});
