import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { HourTrackDB } from './schema';
import { createCard, createEntry, deleteCardPermanently, initDB } from './queries';

let testDb: HourTrackDB;

function cardInput(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
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
    startMinutes: 600,
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
  testDb = new HourTrackDB(`hourtrack-hard-del-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('deleteCardPermanently', () => {
  it('removes the card', async () => {
    const card = await createCard(testDb, cardInput());
    await deleteCardPermanently(testDb, card.id);
    expect(await testDb.cards.get(card.id)).toBeUndefined();
  });

  it('cascades: removes all entries belonging to the card', async () => {
    const card = await createCard(testDb, cardInput());
    await createEntry(testDb, entryInput(card.id, '2026-05-14'));
    await createEntry(testDb, entryInput(card.id, '2026-05-15'));
    await createEntry(testDb, entryInput(card.id, '2026-05-16'));

    await deleteCardPermanently(testDb, card.id);

    expect(await testDb.entries.where('cardId').equals(card.id).count()).toBe(0);
  });

  it('leaves entries for other cards untouched', async () => {
    const keep = await createCard(testDb, cardInput({ name: 'Keep' }));
    const drop = await createCard(testDb, cardInput({ name: 'Drop' }));
    await createEntry(testDb, entryInput(keep.id, '2026-05-14'));
    await createEntry(testDb, entryInput(drop.id, '2026-05-14'));

    await deleteCardPermanently(testDb, drop.id);

    expect(await testDb.cards.get(keep.id)).toBeTruthy();
    expect(await testDb.entries.where('cardId').equals(keep.id).count()).toBe(1);
  });

  it('is a no-op when the card does not exist', async () => {
    await expect(deleteCardPermanently(testDb, 'nope')).resolves.not.toThrow();
  });
});
