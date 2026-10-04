import type { Card } from '@hourtrack/shared-types';

import { CARD_POSITION_SPACING, compareCardIds } from '../schema';
import type { HourTrackDB } from '../schema';
import { nowIso } from '../mutate';

// Card display order (001-cards-order-colors): ranks, the comparator and moves.

/**
 * The display order (001-cards-order-colors): `(position, id)` ascending.
 * `id` breaks ties so the order stays total — two devices can legitimately
 * land two cards on the same rank, and both must then agree on which comes
 * first.
 */
export function compareCardsForDisplay(a: Card, b: Card): number {
  // A row that skipped the write guards (`applySnapshot` writes cards with a
  // raw `bulkPut`) can carry a rank that is not a number. `a.position -
  // b.position` would then be `NaN`, which `Array.prototype.sort` reads as
  // "equal" — so the row would land wherever the engine's pivots happened to
  // put it, differently between renders and between devices. Sort it last,
  // consistently, and let the id break the tie with its peers.
  const rankA = rankOf(a);
  const rankB = rankOf(b);
  if (rankA !== rankB) return rankA - rankB;
  return compareCardIds(a.id, b.id);
}

/** A card's rank for comparison purposes; unrankable rows sort last. */
function rankOf(card: Card): number {
  return Number.isFinite(card.position) ? card.position : Number.POSITIVE_INFINITY;
}

/**
 * Next rank for a card entering the row — a create, or a restore from the
 * archive. Counts archived cards too: an archived card keeps its rank, so
 * ignoring them could hand out a position that already exists.
 */
export async function nextCardPosition(db: HourTrackDB): Promise<number> {
  const cards = await db.cards.toArray();
  const unrankable = cards.filter((c) => !Number.isFinite(c.position));
  if (unrankable.length > 0) {
    // Such a row can only come from a write that skipped the guards
    // (`applySnapshot`'s bulkPut). Excluding it from the max keeps this
    // function working, but staying quiet about it would hide the only
    // moment anything in the app actually notices.
    console.error(
      `[queries] cards with an unusable position: ${unrankable.map((c) => c.id).join(', ')}`,
    );
  }
  const positions = cards.map((c) => c.position).filter((p) => Number.isFinite(p));
  if (positions.length === 0) return 0;
  return Math.max(...positions) + CARD_POSITION_SPACING;
}

/**
 * Below this gap between neighbouring ranks, midpoint inserts stop being
 * worth the float precision they cost and the row is renumbered instead.
 * 1e-3 leaves room for ~20 consecutive inserts into the same gap starting
 * from the canonical 1024 spacing, which no real drag session reaches.
 */
const CARD_POSITION_MIN_GAP = 1e-3;

/**
 * The rank a card takes when it lands between `prev` and `next`: the midpoint
 * of the two, or one canonical step past whichever end of the row it landed
 * on. At least one neighbour always exists — see `reorderCard`, whose only
 * caller-visible no-neighbour case (a single-card row) returns early.
 */
function rankBetween(prev: Card | undefined, next: Card | undefined): number {
  if (prev && next) return (prev.position + next.position) / 2;
  if (prev) return prev.position + CARD_POSITION_SPACING;
  return (next as Card).position - CARD_POSITION_SPACING;
}

/**
 * Move `cardId` so it sits at `toIndex` among the ACTIVE cards.
 *
 * Writes the midpoint rank of its new neighbours — one row, one write — so
 * a concurrent move of a different card on another device merges cleanly
 * under per-row LWW. `toIndex` is clamped to the row; a no-op move writes
 * nothing. Resolves to the card's new position.
 */
export async function reorderCard(
  db: HourTrackDB,
  cardId: string,
  toIndex: number,
): Promise<number> {
  return db.transaction('rw', db.cards, async () => {
    const active = (await db.cards.filter((c) => !c.isArchived).toArray()).sort(
      compareCardsForDisplay,
    );
    const fromIndex = active.findIndex((c) => c.id === cardId);
    if (fromIndex === -1) {
      throw new Error(`reorderCard: no active card with id ${cardId}`);
    }
    const target = Math.min(Math.max(Math.trunc(toIndex), 0), active.length - 1);
    const moved = active[fromIndex] as Card;
    if (target === fromIndex) return moved.position;

    const without = active.filter((_, i) => i !== fromIndex);
    const prev = without[target - 1];
    const next = without[target];
    // `without` is non-empty here (a single-card row can only be a no-op),
    // so at least one neighbour exists.
    const position = rankBetween(prev, next);

    const tooTight =
      (prev != null && Math.abs(position - prev.position) < CARD_POSITION_MIN_GAP) ||
      (next != null && Math.abs(next.position - position) < CARD_POSITION_MIN_GAP);

    const now = nowIso();
    if (tooTight) {
      // Renumber the whole active row to the canonical spacing, in the
      // order the user just asked for. Archived cards keep their ranks —
      // `id` still breaks any tie that creates.
      const reordered = [...without.slice(0, target), moved, ...without.slice(target)];
      await Promise.all(
        reordered.map((card, index) =>
          db.cards.update(card.id, { position: index * CARD_POSITION_SPACING, updatedAt: now }),
        ),
      );
      return target * CARD_POSITION_SPACING;
    }

    await db.cards.update(cardId, { position, updatedAt: now });
    return position;
  });
}
