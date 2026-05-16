/**
 * Tests for the S03 followup defensive validation layer in queries.ts:
 * - color must be in CARD_COLORS palette
 * - rate-type invariants (hourly => hourlyRate non-null + fixedTotal null; vice versa)
 *
 * These complement the existing db.test.ts happy-path tests.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Card } from '@hourtrack/shared-types';

import { HourTrackDB } from './schema';
import { createCard, initDB, updateCard } from './queries';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-test-shape-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

function newCard(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Test',
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

describe('createCard shape validation', () => {
  it('throws when color is not in CARD_COLORS palette', async () => {
    await expect(createCard(db, newCard({ color: '#123456' }))).rejects.toThrow(/color/i);
  });

  it('throws when rateType=hourly and hourlyRate is null', async () => {
    await expect(createCard(db, newCard({ rateType: 'hourly', hourlyRate: null }))).rejects.toThrow(
      /hourlyRate/i,
    );
  });

  it('throws when rateType=hourly and fixedTotal is non-null', async () => {
    await expect(
      createCard(db, newCard({ rateType: 'hourly', hourlyRate: 20, fixedTotal: 500 })),
    ).rejects.toThrow(/fixedTotal/i);
  });

  it('throws when rateType=fixed and fixedTotal is null', async () => {
    await expect(
      createCard(db, newCard({ rateType: 'fixed', hourlyRate: null, fixedTotal: null })),
    ).rejects.toThrow(/fixedTotal/i);
  });

  it('throws when rateType=fixed and hourlyRate is non-null', async () => {
    await expect(
      createCard(db, newCard({ rateType: 'fixed', hourlyRate: 20, fixedTotal: 1000 })),
    ).rejects.toThrow(/hourlyRate/i);
  });

  it('accepts a valid hourly card', async () => {
    const card = await createCard(db, newCard({ rateType: 'hourly', hourlyRate: 20 }));
    expect(card.hourlyRate).toBe(20);
  });

  it('accepts a valid fixed card', async () => {
    const card = await createCard(
      db,
      newCard({ rateType: 'fixed', hourlyRate: null, fixedTotal: 1000 }),
    );
    expect(card.fixedTotal).toBe(1000);
  });
});

describe('updateCard shape validation', () => {
  it('throws when patch flips color to an off-palette hex', async () => {
    const card = await createCard(db, newCard());
    await expect(updateCard(db, card.id, { color: '#abcdef' })).rejects.toThrow(/color/i);
  });

  it('throws when patch flips rateType to fixed without supplying fixedTotal', async () => {
    const card = await createCard(db, newCard()); // hourly
    await expect(updateCard(db, card.id, { rateType: 'fixed', hourlyRate: null })).rejects.toThrow(
      /fixedTotal/i,
    );
  });

  it('accepts a coherent rate-type switch (hourly -> fixed)', async () => {
    const card = await createCard(db, newCard()); // hourly + hourlyRate=20
    const updated = await updateCard(db, card.id, {
      rateType: 'fixed',
      hourlyRate: null,
      fixedTotal: 800,
    });
    expect(updated.rateType).toBe('fixed');
    expect(updated.hourlyRate).toBeNull();
    expect(updated.fixedTotal).toBe(800);
  });

  it('allows partial patches that do not touch rate fields', async () => {
    const card = await createCard(db, newCard());
    const updated = await updateCard(db, card.id, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
  });
});
