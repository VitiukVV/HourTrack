import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/lib/i18n/i18n';

import { db, getAllShoppingItems } from '@/lib/db';
import type { Card, ShoppingItem } from '@/shared/types';

vi.mock('@/features/sync/SyncManager', () => ({
  getSyncManager: () => ({ enqueue: () => Promise.resolve() }),
}));

import { ShoppingHouseBlock } from './ShoppingHouseBlock';

const card = { id: 'c1', name: 'Raquel', color: '#DC2626' } as Card;

function item(id: string, overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id,
    cardId: 'c1',
    text: id,
    addedPeriod: '2026-10',
    boughtAt: null,
    boughtPeriod: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderBlock(needed: ShoppingItem[], bought: ShoppingItem[] = []) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return render(<ShoppingHouseBlock card={card} month={{ needed, bought }} period="2026-10" />, {
    wrapper: Wrapper,
  });
}

const header = () => screen.getByRole('button', { name: /Raquel/ });
const addField = () =>
  screen.getByRole('textbox', { name: i18n.t('shopping.addLabel', { house: 'Raquel' }) });

beforeEach(async () => {
  await db.shoppingItems.clear();
});

describe('ShoppingHouseBlock', () => {
  it('shows the house, the needed count, needed items before bought ones', () => {
    renderBlock(
      [item('Bags'), item('Soap')],
      [item('Gloves', { boughtAt: 'x', boughtPeriod: '2026-10' })],
    );

    expect(header()).toHaveAttribute('aria-expanded', 'true');
    expect(header()).toHaveTextContent(i18n.t('shopping.needed', { count: 2 }));
    expect(screen.getAllByTestId('shopping-item').map((li) => li.textContent)).toEqual([
      'Bags',
      'Soap',
      'Gloves',
    ]);
    expect(screen.getByRole('checkbox', { name: 'Gloves' })).toBeChecked();
  });

  it('stays collapsed to the house name when the month has no items, and opens on tap', async () => {
    renderBlock([]);

    expect(header()).toHaveAttribute('aria-expanded', 'false');
    expect(header()).not.toHaveTextContent(i18n.t('shopping.needed', { count: 0 }));
    await userEvent.click(header());
    expect(header()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(i18n.t('shopping.empty'))).toBeInTheDocument();
  });

  it('adds an item for this house and clears the field', async () => {
    renderBlock([]);
    const user = userEvent.setup();
    await user.click(header());

    await user.type(addField(), '  White bags {Enter}');

    await waitFor(async () => {
      expect(await getAllShoppingItems(db)).toEqual([
        expect.objectContaining({ cardId: 'c1', text: 'White bags' }),
      ]);
    });
    await waitFor(() => expect(addField()).toHaveValue(''));
  });

  it('does not add a blank item', async () => {
    renderBlock([]);
    const user = userEvent.setup();
    await user.click(header());

    await user.type(addField(), '   {Enter}');

    expect(screen.getByRole('button', { name: i18n.t('shopping.add') })).toBeDisabled();
    expect(await getAllShoppingItems(db)).toEqual([]);
  });
});
