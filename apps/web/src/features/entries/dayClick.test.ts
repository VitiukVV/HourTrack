import { describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { dayClickAction, type DayClickInput } from './dayClick';

function makeCard(overrides: Partial<Card> = {}): Card {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'card-1',
    name: 'Card',
    color: '#2563EB',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'entry-1',
    cardId: 'card-1',
    date: '2026-05-14',
    startMinutes: 600,
    durationMin: 60,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function baseInput(over: Partial<DayClickInput> = {}): DayClickInput {
  return {
    activeCardId: null,
    cardsById: new Map(),
    entriesByCard: new Map(),
    date: '2026-05-14',
    ...over,
  };
}

describe('dayClickAction', () => {
  it('returns { kind: "open-picker" } when no active card is set', () => {
    const result = dayClickAction(baseInput({ activeCardId: null }));
    expect(result.kind).toBe('open-picker');
  });

  it('returns { kind: "create", card, date } when active card has no entry for that date', () => {
    const card = makeCard({ id: 'card-A' });
    const result = dayClickAction(
      baseInput({
        activeCardId: 'card-A',
        cardsById: new Map([['card-A', card]]),
        entriesByCard: new Map(),
        date: '2026-05-14',
      }),
    );
    expect(result.kind).toBe('create');
    if (result.kind === 'create') {
      expect(result.card).toBe(card);
      expect(result.date).toBe('2026-05-14');
    }
  });

  it('returns { kind: "create" } when active card has entries but none on this date', () => {
    const card = makeCard({ id: 'card-A' });
    const otherEntry = makeEntry({ cardId: 'card-A', date: '2026-05-15' });
    const result = dayClickAction(
      baseInput({
        activeCardId: 'card-A',
        cardsById: new Map([['card-A', card]]),
        entriesByCard: new Map([['card-A', [otherEntry]]]),
        date: '2026-05-14',
      }),
    );
    expect(result.kind).toBe('create');
  });

  it('returns { kind: "delete", entry } when active card already has an entry for that date', () => {
    const card = makeCard({ id: 'card-A' });
    const sameDay = makeEntry({ id: 'e-same', cardId: 'card-A', date: '2026-05-14' });
    const result = dayClickAction(
      baseInput({
        activeCardId: 'card-A',
        cardsById: new Map([['card-A', card]]),
        entriesByCard: new Map([['card-A', [sameDay]]]),
        date: '2026-05-14',
      }),
    );
    expect(result.kind).toBe('delete');
    if (result.kind === 'delete') {
      expect(result.entry).toBe(sameDay);
    }
  });

  it('falls back to "open-picker" when activeCardId is set but the card is not in cardsById (defensive)', () => {
    // Active card was archived/deleted while still selected in another tab — bucket missing.
    const result = dayClickAction(
      baseInput({
        activeCardId: 'card-gone',
        cardsById: new Map(),
        entriesByCard: new Map(),
        date: '2026-05-14',
      }),
    );
    expect(result.kind).toBe('open-picker');
  });

  it('ignores other cards’ entries on the same day when deciding create vs delete', () => {
    const cardA = makeCard({ id: 'card-A' });
    const cardB = makeCard({ id: 'card-B' });
    const bEntry = makeEntry({ id: 'eb', cardId: 'card-B', date: '2026-05-14' });
    // Active card is A, but only card B has an entry on this date → create for A.
    const result = dayClickAction(
      baseInput({
        activeCardId: 'card-A',
        cardsById: new Map([
          ['card-A', cardA],
          ['card-B', cardB],
        ]),
        entriesByCard: new Map([['card-B', [bEntry]]]),
        date: '2026-05-14',
      }),
    );
    expect(result.kind).toBe('create');
  });
});
