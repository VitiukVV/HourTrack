import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/lib/i18n/i18n';

import { addShoppingItem, db, getAllShoppingItems } from '@/lib/db';
import type { ShoppingItem } from '@/shared/types';

vi.mock('@/features/sync/SyncManager', () => ({
  getSyncManager: () => ({ enqueue: () => Promise.resolve() }),
}));

import { ShoppingItemRow } from './ShoppingItemRow';

const editButton = (text: string) =>
  screen.getByRole('button', { name: i18n.t('shopping.edit', { text }) });
const deleteButton = (text: string) =>
  screen.getByRole('button', { name: i18n.t('shopping.delete', { text }) });

function renderRow(item: ShoppingItem, bought = false) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return render(
    <ul>
      <ShoppingItemRow item={item} bought={bought} period={item.addedPeriod} />
    </ul>,
    { wrapper: Wrapper },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await db.shoppingItems.clear();
  await db.tombstones.clear();
});

describe('ShoppingItemRow', () => {
  it('ticks a needed item as bought', async () => {
    const item = await addShoppingItem(db, 'c1', 'White bags');
    renderRow(item);

    await userEvent.click(screen.getByRole('checkbox', { name: 'White bags' }));

    await waitFor(async () => {
      expect((await getAllShoppingItems(db))[0]?.boughtPeriod).not.toBeNull();
    });
  });

  it('shows a bought item ticked and struck through, and unticks it', async () => {
    const item = await addShoppingItem(db, 'c1', 'Soap');
    renderRow({ ...item, boughtAt: item.createdAt, boughtPeriod: item.addedPeriod }, true);

    const box = screen.getByRole('checkbox', { name: 'Soap' });
    expect(box).toBeChecked();
    expect(screen.getByText('Soap').className).toContain('line-through');

    await userEvent.click(box);
    await waitFor(async () => {
      expect((await getAllShoppingItems(db))[0]?.boughtPeriod).toBeNull();
    });
  });

  it('wraps long text instead of widening the row', async () => {
    const item = await addShoppingItem(db, 'c1', 'x'.repeat(200));
    renderRow(item);
    const label = screen.getByText('x'.repeat(200));
    expect(label.className).toContain('break-words');
    expect(label.className).toContain('min-w-0');
  });

  it('edits the text inline with Enter and cancels with Escape', async () => {
    const item = await addShoppingItem(db, 'c1', 'Bags');
    renderRow(item);
    const user = userEvent.setup();

    await user.click(editButton('Bags'));
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('Bags');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await user.click(editButton('Bags'));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Black bags{Enter}');

    await waitFor(async () => {
      expect((await getAllShoppingItems(db))[0]?.text).toBe('Black bags');
    });
  });

  it('ignores an edit that leaves the text blank', async () => {
    const item = await addShoppingItem(db, 'c1', 'Bags');
    renderRow(item);
    const user = userEvent.setup();

    await user.click(editButton('Bags'));
    await user.clear(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect((await getAllShoppingItems(db))[0]?.text).toBe('Bags');
  });

  it('deletes the item', async () => {
    const item = await addShoppingItem(db, 'c1', 'Bags');
    renderRow(item);

    await userEvent.click(deleteButton('Bags'));

    await waitFor(async () => expect(await getAllShoppingItems(db)).toEqual([]));
  });

  it('Escape after typing discards the change and does not save on blur', async () => {
    const item = await addShoppingItem(db, 'c1', 'Bags');
    const updateSpy = vi.spyOn(db.shoppingItems, 'put');
    renderRow(item);
    const user = userEvent.setup();

    await user.click(editButton('Bags'));
    await user.type(screen.getByRole('textbox'), ' extra');
    await user.keyboard('{Escape}');
    await user.click(document.body);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(updateSpy).not.toHaveBeenCalled();
    expect((await getAllShoppingItems(db))[0]?.text).toBe('Bags');
  });

  it('leaving the field saves the edit', async () => {
    const item = await addShoppingItem(db, 'c1', 'Bags');
    renderRow(item);
    const user = userEvent.setup();

    await user.click(editButton('Bags'));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Paper bags');
    await user.click(document.body);

    await waitFor(async () => {
      expect((await getAllShoppingItems(db))[0]?.text).toBe('Paper bags');
    });
  });

  it('keeps the typed text in the field when saving fails', async () => {
    const item = await addShoppingItem(db, 'c1', 'Bags');
    await db.shoppingItems.clear(); // the save will not find the row
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderRow(item);
    const user = userEvent.setup();

    await user.click(editButton('Bags'));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Paper bags{Enter}');

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Paper bags'));
  });
});
