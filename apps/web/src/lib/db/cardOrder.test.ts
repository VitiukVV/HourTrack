/**
 * 001-cards-order-colors — the ordered card query layer.
 *
 * Cards are displayed by `(position, id)` ascending. `position` is a
 * FRACTIONAL rank, not an index: a move writes the midpoint of its new
 * neighbours so exactly one row changes and the per-row LWW merge resolves
 * a concurrent move cleanly. See specs/001-cards-order-colors/research.md D1
 * and contracts/card-ordering.md.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Card } from '@hourtrack/shared-types';

import {
  archiveCard,
  createCard,
  updateCard,
  getArchivedCardsOrdered,
  getCardsOrdered,
  initDB,
  nextCardPosition,
  reorderCard,
  restoreCard,
} from './queries';
import { CARD_POSITION_SPACING, HourTrackDB } from './schema';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-test-order-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

const SEEDED_AT = '2026-09-01T10:00:00.000Z';

/**
 * Writes a card row directly so the test controls `position` and `id`
 * exactly — `createCard` deliberately assigns the next rank itself.
 */
async function seed(id: string, position: number, isArchived = false): Promise<Card> {
  const card: Card = {
    id,
    name: id,
    color: '#2563EB',
    position,
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived,
    archivedAt: isArchived ? SEEDED_AT : null,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  };
  await db.cards.add(card);
  return card;
}

const ids = (cards: Card[]): string[] => cards.map((c) => c.id);

describe('getCardsOrdered', () => {
  it('returns active cards by ascending position, not by insertion order', async () => {
    await seed('c-inserted-first', 2048);
    await seed('c-inserted-second', 0);
    await seed('c-inserted-third', 1024);

    expect(ids(await getCardsOrdered(db))).toEqual([
      'c-inserted-second',
      'c-inserted-third',
      'c-inserted-first',
    ]);
  });

  it('excludes archived cards by default', async () => {
    await seed('c-active', 0);
    await seed('c-archived', 1024, true);

    expect(ids(await getCardsOrdered(db))).toEqual(['c-active']);
  });

  it('includes archived cards under the same comparator when asked', async () => {
    await seed('c-active-late', 2048);
    await seed('c-archived-early', 1024, true);
    await seed('c-active-first', 0);

    expect(ids(await getCardsOrdered(db, true))).toEqual([
      'c-active-first',
      'c-archived-early',
      'c-active-late',
    ]);
  });

  it('breaks ties on id so a cross-device merge still yields a total order', async () => {
    // Two devices can legitimately land two cards on the same rank; the
    // order must still be stable and identical on both.
    await seed('c-bbb', 1024);
    await seed('c-aaa', 1024);
    await seed('c-ccc', 1024);

    expect(ids(await getCardsOrdered(db))).toEqual(['c-aaa', 'c-bbb', 'c-ccc']);
  });

  it('returns an empty list when there are no cards', async () => {
    expect(await getCardsOrdered(db)).toEqual([]);
  });
});

describe('getArchivedCardsOrdered', () => {
  it('returns archived cards only, ordered by rank', async () => {
    await seed('c-active', 0);
    await seed('c-archived-late', 3072, true);
    await seed('c-archived-early', 1024, true);

    expect(ids(await getArchivedCardsOrdered(db))).toEqual(['c-archived-early', 'c-archived-late']);
  });
});

describe('nextCardPosition', () => {
  it('returns one spacing past the highest rank in the table', async () => {
    await seed('c-1', 0);
    await seed('c-2', 1024);
    await seed('c-3', 2048);

    expect(await nextCardPosition(db)).toBe(2048 + CARD_POSITION_SPACING);
  });

  it('counts archived cards too, so a restored card cannot collide', async () => {
    await seed('c-active', 0);
    await seed('c-archived', 9000, true);

    expect(await nextCardPosition(db)).toBe(9000 + CARD_POSITION_SPACING);
  });

  it('starts at zero on an empty table', async () => {
    expect(await nextCardPosition(db)).toBe(0);
  });
});

describe('reorderCard', () => {
  /** A, B, C at the canonical seeded spacing. */
  async function seedThree(): Promise<void> {
    await seed('c-a', 0);
    await seed('c-b', 1024);
    await seed('c-c', 2048);
  }

  it('writes the midpoint of the new neighbours', async () => {
    await seedThree();

    const position = await reorderCard(db, 'c-a', 1);

    expect(position).toBe(1536); // between B (1024) and C (2048)
    expect(ids(await getCardsOrdered(db))).toEqual(['c-b', 'c-a', 'c-c']);
  });

  it('moves a card to the front by stepping one spacing below the first rank', async () => {
    await seedThree();

    const position = await reorderCard(db, 'c-c', 0);

    expect(position).toBe(-CARD_POSITION_SPACING);
    expect(ids(await getCardsOrdered(db))).toEqual(['c-c', 'c-a', 'c-b']);
  });

  it('moves a card to the end by stepping one spacing above the last rank', async () => {
    await seedThree();

    const position = await reorderCard(db, 'c-a', 2);

    expect(position).toBe(2048 + CARD_POSITION_SPACING);
    expect(ids(await getCardsOrdered(db))).toEqual(['c-b', 'c-c', 'c-a']);
  });

  it('bumps updatedAt on the moved card so the merge can see the move', async () => {
    await seedThree();

    await reorderCard(db, 'c-a', 2);

    const after = await db.cards.get('c-a');
    expect(after?.updatedAt).not.toBe(SEEDED_AT);
    expect(Date.parse(after?.updatedAt ?? '')).toBeGreaterThan(Date.parse(SEEDED_AT));
  });

  it('leaves every other card untouched', async () => {
    await seedThree();
    const before = await db.cards.get('c-b');

    await reorderCard(db, 'c-a', 2);

    expect(await db.cards.get('c-b')).toEqual(before);
  });

  it('is a no-op when the card is already at that index', async () => {
    await seedThree();
    const before = await db.cards.get('c-b');

    const position = await reorderCard(db, 'c-b', 1);

    expect(position).toBe(1024);
    expect(await db.cards.get('c-b')).toEqual(before);
  });

  it('clamps an index past the end of the row', async () => {
    await seedThree();

    const position = await reorderCard(db, 'c-a', 99);

    expect(position).toBe(2048 + CARD_POSITION_SPACING);
    expect(ids(await getCardsOrdered(db))).toEqual(['c-b', 'c-c', 'c-a']);
  });

  it('clamps a negative index to the front', async () => {
    await seedThree();

    const position = await reorderCard(db, 'c-c', -5);

    expect(position).toBe(-CARD_POSITION_SPACING);
    expect(ids(await getCardsOrdered(db))).toEqual(['c-c', 'c-a', 'c-b']);
  });

  it('ignores archived cards when resolving the target index', async () => {
    await seed('c-a', 0);
    await seed('c-archived', 512, true);
    await seed('c-b', 1024);

    // Index 1 among the ACTIVE cards is B's slot, so A lands after B.
    const position = await reorderCard(db, 'c-a', 1);

    expect(position).toBe(1024 + CARD_POSITION_SPACING);
    expect(ids(await getCardsOrdered(db))).toEqual(['c-b', 'c-a']);
  });

  it('renormalises the whole active row when the gap would collapse', async () => {
    // Repeated midpoint inserts into the same gap eventually exhaust float
    // precision; once the next midpoint would sit closer than 1e-3 to a
    // neighbour the row is renumbered back to the canonical spacing.
    await seed('c-a', 0);
    await seed('c-b', 0.0004);
    await seed('c-c', 1024);

    const position = await reorderCard(db, 'c-c', 1);

    expect(ids(await getCardsOrdered(db))).toEqual(['c-a', 'c-c', 'c-b']);
    expect(position).toBe(CARD_POSITION_SPACING);
    const renumbered = await getCardsOrdered(db);
    expect(renumbered.map((c) => c.position)).toEqual([0, 1024, 2048]);
  });

  it('bumps updatedAt on every card it renumbers', async () => {
    await seed('c-a', 0);
    await seed('c-b', 0.0004);
    await seed('c-c', 1024);

    await reorderCard(db, 'c-c', 1);

    for (const card of await getCardsOrdered(db)) {
      expect(card.updatedAt).not.toBe(SEEDED_AT);
    }
  });

  it('throws for an unknown card id', async () => {
    await seedThree();
    await expect(reorderCard(db, 'c-missing', 0)).rejects.toThrow(/c-missing/);
  });

  it('throws when the card is archived and therefore not in the row', async () => {
    await seed('c-a', 0);
    await seed('c-archived', 1024, true);
    await expect(reorderCard(db, 'c-archived', 0)).rejects.toThrow(/c-archived/);
  });
});

describe('positions assigned by the write helpers', () => {
  function input(id: string, name: string): Parameters<typeof createCard>[1] {
    return {
      id,
      name,
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
    };
  }

  it('appends a new card to the end of the row', async () => {
    await seed('c-a', 0);
    await seed('c-b', 1024);

    const created = await createCard(db, input('c-new', 'New'));

    expect(created.position).toBe(1024 + CARD_POSITION_SPACING);
    expect(ids(await getCardsOrdered(db))).toEqual(['c-a', 'c-b', 'c-new']);
  });

  it('starts the first card of a fresh install at zero', async () => {
    const created = await createCard(db, input('c-first', 'First'));
    expect(created.position).toBe(0);
  });

  it('honours an explicit position, which the snapshot restore path needs', async () => {
    const created = await createCard(db, { ...input('c-seeded', 'Seeded'), position: 4096 });
    expect(created.position).toBe(4096);
  });

  it('re-appends a restored card instead of dropping it back into the middle', async () => {
    await seed('c-a', 0);
    const archived = await seed('c-old', 512);
    await seed('c-b', 1024);
    await archiveCard(db, archived.id);

    const restored = await restoreCard(db, archived.id);

    expect(restored.position).toBe(1024 + CARD_POSITION_SPACING);
    expect(ids(await getCardsOrdered(db))).toEqual(['c-a', 'c-b', 'c-old']);
  });
});

// ---------------------------------------------------------------------------
// Robustness of the ordering layer against rows it did not write itself.
// `applySnapshot` puts cards into Dexie with a raw `bulkPut`, so a row can
// reach these helpers without ever passing `assertCardShape`.
// ---------------------------------------------------------------------------

describe('ordering layer — rows that skipped the write guards', () => {
  /** Writes a row with a deliberately broken field, bypassing every helper. */
  async function seedRaw(id: string, overrides: Record<string, unknown>): Promise<void> {
    const base = await seed(`${id}-template`, 0);
    await db.cards.delete(`${id}-template`);
    await db.cards.add({ ...base, id, ...overrides } as Card);
  }

  it('orders a card with no position deterministically instead of arbitrarily', async () => {
    // `a.position - b.position` is NaN here, and `Array.prototype.sort` reads
    // a NaN comparator result as "equal" — so the row lands wherever the
    // engine's pivot choices put it, differently between renders and between
    // devices. A card that wanders is a bug report nobody can reproduce.
    await seed('c-a', 0);
    await seed('c-b', 1024);
    await seedRaw('c-broken', { position: undefined });

    const first = ids(await getCardsOrdered(db));
    const second = ids(await getCardsOrdered(db));

    expect(first).toEqual(second);
    // Ranked cards keep their order, and the unrankable row goes last.
    expect(first).toEqual(['c-a', 'c-b', 'c-broken']);
  });

  it('restores a card whose stored shape is legacy-invalid', async () => {
    // The escape hatch `updateCard`'s `touchesShape` exists for: an hourly
    // card with no rate, written by `applySnapshot`'s bulkPut from an old
    // backup. Archive still worked; restore must too, because the archive
    // list is the only place the user can act on such a card.
    await seed('c-a', 0);
    await seedRaw('c-legacy', { hourlyRate: null, isArchived: true, archivedAt: SEEDED_AT });

    const restored = await restoreCard(db, 'c-legacy');

    expect(restored.isArchived).toBe(false);
    expect(restored.position).toBe(CARD_POSITION_SPACING);
    expect(ids(await getCardsOrdered(db))).toEqual(['c-a', 'c-legacy']);
  });

  it('still refuses a bad position on an ordinary card edit', async () => {
    // The hatch is for archive/restore only — a normal patch that carries a
    // rank must still be validated.
    const card = await seed('c-a', 0);
    await expect(updateCard(db, card.id, { position: Number.NaN })).rejects.toThrow(/position/i);
  });
});

// ---------------------------------------------------------------------------
// Rank arithmetic under sustained use: does renormalisation actually fire,
// and does the row stay a total order afterwards?
// ---------------------------------------------------------------------------

describe('reorderCard — convergence', () => {
  it('survives thirty consecutive inserts into the same gap', async () => {
    // Each move puts a card between the same two neighbours, halving the gap.
    // If the renormalisation threshold or the midpoint maths were wrong, the
    // ranks would converge to equal floats and the row would silently fall
    // back to id order — with no error anywhere.
    await seed('c-a', 0);
    await seed('c-b', CARD_POSITION_SPACING);
    await seed('c-c', CARD_POSITION_SPACING * 2);

    for (let i = 0; i < 30; i++) {
      await reorderCard(db, i % 2 === 0 ? 'c-c' : 'c-a', 1);
    }

    const cards = await getCardsOrdered(db);
    const positions = cards.map((c) => c.position);
    expect(positions.every((p) => Number.isFinite(p))).toBe(true);
    // Distinct ranks: the point of renormalising is that midpoints never run
    // out of room.
    expect(new Set(positions).size).toBe(3);
    // And the last move is honoured: after an even number of iterations the
    // last card moved was 'c-a' into the middle.
    expect(cards[1]!.id).toBe('c-a');
  });

  it('renumbers a row that arrived from a merge with duplicate ranks', async () => {
    // Two devices can legitimately land three cards on the same rank. That is
    // the realistic post-merge input, and it is the one input where every
    // midpoint is degenerate.
    await seed('c-a', 1024);
    await seed('c-b', 1024);
    await seed('c-c', 1024);

    await reorderCard(db, 'c-c', 1);

    const cards = await getCardsOrdered(db);
    expect(ids(cards)).toEqual(['c-a', 'c-c', 'c-b']);
    expect(new Set(cards.map((c) => c.position)).size).toBe(3);
  });

  it('is a no-op on a single-card row, whichever index is asked for', async () => {
    // `reorderCard` leans on this: its neighbour lookup asserts that a
    // non-empty row remains after removing the moved card.
    const only = await seed('c-only', 512);

    expect(await reorderCard(db, 'c-only', 0)).toBe(512);
    expect(await reorderCard(db, 'c-only', 5)).toBe(512);

    const after = await db.cards.get('c-only');
    expect(after?.position).toBe(512);
    // A no-op writes nothing at all — not even a fresh `updatedAt`.
    expect(after?.updatedAt).toBe(only.updatedAt);
  });

  it('leaves the archived-inclusive list total after a renumbering', async () => {
    // Renormalisation rewrites the ACTIVE cards onto the 0..n*1024 grid and
    // leaves archived ranks alone, so an archived card can end up sharing a
    // rank with an active one. That is allowed — `(position, id)` is still a
    // total order — but it must be STABLE: the reports filter with archived
    // shown renders this list, and a card that changes slot between reads
    // would look like a bug nobody can reproduce.
    await seed('c-a', 0);
    await seed('c-b', CARD_POSITION_SPACING);
    await seed('c-archived', CARD_POSITION_SPACING, true);
    await seed('c-c', CARD_POSITION_SPACING * 2);

    // Force the renormalisation branch with a degenerate gap.
    await db.cards.update('c-b', { position: 0.0001 });
    await reorderCard(db, 'c-c', 1);

    const first = ids(await getCardsOrdered(db, true));
    expect(ids(await getCardsOrdered(db, true))).toEqual(first);
    // The active cards keep the order the user asked for, whatever slot the
    // archived card lands in between them.
    expect(first.filter((id) => id !== 'c-archived')).toEqual(['c-a', 'c-c', 'c-b']);
  });
});
