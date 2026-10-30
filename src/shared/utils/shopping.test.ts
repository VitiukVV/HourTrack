import { describe, expect, it } from 'vitest';

import type { ShoppingItem } from '@/shared/types';

import { SHOPPING_TEXT_MAX, normalizeShoppingText, shoppingItemsForMonth } from './shopping';

function item(overrides: Partial<ShoppingItem> & Pick<ShoppingItem, 'id'>): ShoppingItem {
  return {
    cardId: 'c1',
    text: overrides.id,
    addedPeriod: '2026-10',
    boughtAt: null,
    boughtPeriod: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

const ids = (rows: ShoppingItem[]) => rows.map((r) => r.id);

describe('shoppingItemsForMonth', () => {
  it('lists needed items and the ones bought in that month', () => {
    const rows = [
      item({ id: 'bags' }),
      item({ id: 'soap', boughtAt: '2026-10-20T10:00:00.000Z', boughtPeriod: '2026-10' }),
    ];
    const { needed, bought } = shoppingItemsForMonth(rows, '2026-10');
    expect(ids(needed)).toEqual(['bags']);
    expect(ids(bought)).toEqual(['soap']);
  });

  it('carries unbought items into the next month and drops last month’s bought ones', () => {
    const rows = [
      item({ id: 'bags' }),
      item({ id: 'soap', boughtAt: '2026-10-20T10:00:00.000Z', boughtPeriod: '2026-10' }),
    ];
    const { needed, bought } = shoppingItemsForMonth(rows, '2026-11');
    expect(ids(needed)).toEqual(['bags']);
    expect(bought).toEqual([]);
  });

  it('shows an item bought later as still needed in the earlier month', () => {
    const rows = [
      item({ id: 'bags', boughtAt: '2026-11-03T10:00:00.000Z', boughtPeriod: '2026-11' }),
    ];
    expect(ids(shoppingItemsForMonth(rows, '2026-10').needed)).toEqual(['bags']);
    expect(ids(shoppingItemsForMonth(rows, '2026-11').bought)).toEqual(['bags']);
    expect(shoppingItemsForMonth(rows, '2026-12')).toEqual({ needed: [], bought: [] });
  });

  it('does not show an item before the month it was added', () => {
    const rows = [item({ id: 'bags', addedPeriod: '2026-11' })];
    expect(shoppingItemsForMonth(rows, '2026-10')).toEqual({ needed: [], bought: [] });
  });

  it('shows only needed items in a future month', () => {
    const rows = [
      item({ id: 'bags' }),
      item({ id: 'soap', boughtAt: '2026-10-20T10:00:00.000Z', boughtPeriod: '2026-10' }),
    ];
    const { needed, bought } = shoppingItemsForMonth(rows, '2027-03');
    expect(ids(needed)).toEqual(['bags']);
    expect(bought).toEqual([]);
  });

  it('orders needed oldest first and bought most recently bought first', () => {
    const rows = [
      item({ id: 'n2', createdAt: '2026-10-05T10:00:00.000Z' }),
      item({ id: 'n1', createdAt: '2026-10-02T10:00:00.000Z' }),
      item({ id: 'b1', boughtAt: '2026-10-10T10:00:00.000Z', boughtPeriod: '2026-10' }),
      item({ id: 'b2', boughtAt: '2026-10-12T10:00:00.000Z', boughtPeriod: '2026-10' }),
    ];
    const { needed, bought } = shoppingItemsForMonth(rows, '2026-10');
    expect(ids(needed)).toEqual(['n1', 'n2']);
    expect(ids(bought)).toEqual(['b2', 'b1']);
  });
});

describe('normalizeShoppingText', () => {
  it('trims and collapses nothing else', () => {
    expect(normalizeShoppingText('  White  bags \n')).toBe('White  bags');
  });

  it('rejects blank and oversized text', () => {
    expect(normalizeShoppingText('   ')).toBeNull();
    expect(normalizeShoppingText('x'.repeat(SHOPPING_TEXT_MAX))).toHaveLength(SHOPPING_TEXT_MAX);
    expect(normalizeShoppingText('x'.repeat(SHOPPING_TEXT_MAX + 1))).toBeNull();
  });
});
