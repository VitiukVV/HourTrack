import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, createEntry, initDB } from '@/lib/db';
import type { Card, Entry } from '@hourtrack/shared-types';

import { useDeleteCardMutation } from './useCards';

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

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function cardInput(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Card',
    color: '#3B82F6',
    defaultDurationMin: 480,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    defaultNote: null,
    isArchived: true,
    archivedAt: new Date().toISOString(),
    ...overrides,
  };
}

function entryInput(cardId: string, date: string): Omit<Entry, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    cardId,
    date,
    durationMin: 60,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
  };
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-delete-card-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('useDeleteCardMutation', () => {
  it('hard-deletes a card and cascades to its entries', async () => {
    const card = await createCard(testDb, cardInput({ name: 'Doomed' }));
    await createEntry(testDb, entryInput(card.id, '2026-05-14'));
    await createEntry(testDb, entryInput(card.id, '2026-05-15'));

    const { result } = renderHook(() => useDeleteCardMutation(), { wrapper: wrapper() });
    await result.current.mutateAsync(card.id);

    expect(await testDb.cards.get(card.id)).toBeUndefined();
    expect(await testDb.entries.where('cardId').equals(card.id).count()).toBe(0);
  });

  it('does not affect other cards entries', async () => {
    const keep = await createCard(testDb, cardInput({ name: 'Keep' }));
    const drop = await createCard(testDb, cardInput({ name: 'Drop' }));
    await createEntry(testDb, entryInput(keep.id, '2026-05-14'));
    await createEntry(testDb, entryInput(drop.id, '2026-05-14'));

    const { result } = renderHook(() => useDeleteCardMutation(), { wrapper: wrapper() });
    await result.current.mutateAsync(drop.id);

    expect(await testDb.cards.get(keep.id)).toBeTruthy();
    expect(await testDb.entries.where('cardId').equals(keep.id).count()).toBe(1);
    expect(await testDb.entries.where('cardId').equals(drop.id).count()).toBe(0);
  });

  it('is a no-op when the card does not exist', async () => {
    const { result } = renderHook(() => useDeleteCardMutation(), { wrapper: wrapper() });
    await expect(result.current.mutateAsync('does-not-exist')).resolves.not.toThrow();
  });
});
