import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, getCardsOrdered, initDB } from '@/lib/db';
import type { Card } from '@hourtrack/shared-types';

import { ArchivedCardsList } from './ArchivedCardsList';

/**
 * 001-cards-order-colors (US3) — the archive list obeys the same order as
 * the header, and a restore puts the card back at the END of the active row
 * rather than into whatever slot it held before it was archived.
 */

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
    position: 0,
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

function renderList() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return render(<ArchivedCardsList />, { wrapper: Wrapper });
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-archived-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('ArchivedCardsList', () => {
  it('lists archived cards in (position, id) order', async () => {
    // Ids run counter to the ranks, so id order cannot pass by accident.
    await createCard(
      testDb,
      makeCardInput({
        id: 'c-a',
        name: 'Second',
        position: 1024,
        isArchived: true,
        archivedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    await createCard(
      testDb,
      makeCardInput({
        id: 'c-b',
        name: 'First',
        position: 0,
        isArchived: true,
        archivedAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    renderList();

    await screen.findByTitle('First');
    const names = screen.getAllByTitle(/First|Second/).map((el) => el.getAttribute('title') ?? '');
    expect(names).toEqual(['First', 'Second']);
  });

  it('restoring a card appends it to the end of the active row', async () => {
    await createCard(testDb, makeCardInput({ id: 'c-active-1', name: 'Alpha', position: 0 }));
    await createCard(testDb, makeCardInput({ id: 'c-active-2', name: 'Bravo', position: 1024 }));
    await createCard(
      testDb,
      makeCardInput({
        id: 'c-old',
        name: 'Restored',
        // Its old rank sat between the two active cards; a naive restore
        // would drop it back into the middle of a row that has moved on.
        position: 512,
        isArchived: true,
        archivedAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    renderList();
    await userEvent.click(await screen.findByRole('button', { name: /restore/i }));

    await waitFor(async () => {
      const active = await getCardsOrdered(testDb);
      expect(active.map((c) => c.name)).toEqual(['Alpha', 'Bravo', 'Restored']);
    });
  });

  it('shows the empty state when nothing is archived', async () => {
    renderList();
    expect(await screen.findByTestId('archived-cards-empty')).toBeInTheDocument();
  });
});
