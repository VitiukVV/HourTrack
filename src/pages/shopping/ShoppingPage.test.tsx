import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/lib/i18n/i18n';

import { createCard, db, initDB } from '@/lib/db';
import type { Card, ShoppingItem } from '@/shared/types';

vi.mock('@/features/sync/SyncManager', () => ({
  getSyncManager: () => ({ enqueue: () => Promise.resolve() }),
}));

import { ShoppingPage } from './ShoppingPage';

function card(id: string, name: string, position: number, isArchived = false) {
  return {
    id,
    name,
    color: '#2563EB',
    position,
    defaultDurationMin: 150,
    defaultStartMinutes: 540,
    rateType: 'hourly',
    hourlyRate: 12,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived,
    archivedAt: isArchived ? '2026-09-01T00:00:00.000Z' : null,
  } satisfies Omit<Card, 'createdAt' | 'updatedAt'>;
}

function item(id: string, cardId: string, overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id,
    cardId,
    text: id,
    addedPeriod: '2026-10',
    boughtAt: null,
    boughtPeriod: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return render(<ShoppingPage />, { wrapper: Wrapper });
}

const houseNames = () =>
  screen.getAllByTestId('shopping-house-header').map((h) => h.textContent ?? '');
const itemsOf = (house: string) =>
  within(screen.getByRole('button', { name: new RegExp(house) }).closest('article')!)
    .queryAllByTestId('shopping-item')
    .map((li) => li.textContent);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 15, 12, 0));
  await Promise.all(db.tables.map((t) => t.clear()));
  await initDB(db);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ShoppingPage (spec 015)', () => {
  it('lists every active house in card order and leaves archived ones out', async () => {
    await createCard(db, card('c2', 'Carlos', 2048));
    await createCard(db, card('c1', 'Raquel', 1024));
    await createCard(db, card('c3', 'Old house', 0, true));
    await db.shoppingItems.bulkPut([item('Bags', 'c1'), item('Ghost', 'c3')]);

    renderPage();

    await waitFor(() => expect(houseNames()).toHaveLength(2));
    expect(houseNames()[0]).toContain('Raquel');
    expect(houseNames()[1]).toContain('Carlos');
    expect(screen.queryByText('Ghost')).not.toBeInTheDocument();
  });

  it('carries unbought items into the next month and shows history when stepping back', async () => {
    await createCard(db, card('c1', 'Raquel', 0));
    await db.shoppingItems.bulkPut([
      item('Bags', 'c1'),
      item('Soap', 'c1', { boughtAt: '2026-10-10T00:00:00.000Z', boughtPeriod: '2026-10' }),
    ]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderPage();
    await waitFor(() => expect(itemsOf('Raquel')).toEqual(['Bags', 'Soap']));

    await user.click(screen.getByRole('button', { name: i18n.t('shopping.nextMonth') }));
    await waitFor(() => expect(itemsOf('Raquel')).toEqual(['Bags']));

    await user.click(screen.getByRole('button', { name: i18n.t('shopping.prevMonth') }));
    await user.click(screen.getByRole('button', { name: i18n.t('shopping.prevMonth') }));
    // September: nothing was added yet — the house is collapsed and empty.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Raquel/ })).toHaveAttribute(
        'aria-expanded',
        'false',
      ),
    );
    expect(itemsOf('Raquel')).toEqual([]);
  });

  it('asks for a client card when there are no active houses', async () => {
    await createCard(db, card('c3', 'Old house', 0, true));

    renderPage();

    expect(await screen.findByTestId('shopping-no-houses')).toHaveTextContent(
      i18n.t('shopping.noHouses'),
    );
  });
});
