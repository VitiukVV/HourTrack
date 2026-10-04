import type { Card } from '@hourtrack/shared-types';

import { isValidHexColor } from '@/lib/ui/colors';

import type { HourTrackDB, TombstoneRow } from '../schema';
import { nowIso } from '../mutate';
import { compareCardsForDisplay, nextCardPosition } from './cardOrder';
import { clearTombstone } from './tombstones';

/**
 * Defensive runtime check applied by `createCard` / `updateCard` per the S03
 * followups flagged in the S02 pipeline journal:
 *
 *   1. `color` must be a syntactically valid `#RRGGBB` hex. Until
 *      001-cards-order-colors this was the stricter "one of the 12
 *      `CARD_COLORS`" check; the user can now pick any colour, so the
 *      palette is a set of presets and the invariant is the hex form. A
 *      malformed value would otherwise sneak in via a Drive-snapshot
 *      restore (S11) or a malformed external write and break every
 *      contrast calculation downstream.
 *   2. `position` must be a finite number — the display comparator
 *      `(position, id)` is arithmetic, so `NaN`/`Infinity` would make the
 *      whole row's order undefined.
 *   3. Rate-type invariants:
 *      - `rateType === 'hourly'`  => hourlyRate non-null, fixedTotal === null, monthlyTotal === null
 *      - `rateType === 'fixed'`   => fixedTotal non-null, hourlyRate === null, monthlyTotal === null
 *      - `rateType === 'monthly'` => monthlyTotal non-null, hourlyRate === null, fixedTotal === null (S21)
 *
 * The zod form schema in `@/features/cards/cardSchema.ts` enforces the same
 * rules upstream so users see friendly i18n'd errors before this check fires.
 * This helper is the last line of defense.
 *
 * Throws `Error` with a concrete message (always includes the offending field
 * name) so the layer that triggered the write can surface a useful diagnostic.
 */
function assertCardShape(card: {
  color: string;
  position: number;
  rateType: Card['rateType'];
  hourlyRate: number | null;
  fixedTotal: number | null;
  monthlyTotal: number | null;
}): void {
  if (!isValidHexColor(card.color)) {
    throw new Error(`Invalid card color "${card.color}": expected a #RRGGBB hex`);
  }
  if (!Number.isFinite(card.position)) {
    throw new Error(`Invalid card position "${card.position}": expected a finite number`);
  }
  if (card.rateType === 'hourly') {
    if (card.hourlyRate == null) {
      throw new Error('hourlyRate is required when rateType is "hourly"');
    }
    if (card.fixedTotal != null) {
      throw new Error('fixedTotal must be null when rateType is "hourly"');
    }
    if (card.monthlyTotal != null) {
      throw new Error('monthlyTotal must be null when rateType is "hourly"');
    }
  } else if (card.rateType === 'fixed') {
    if (card.fixedTotal == null) {
      throw new Error('fixedTotal is required when rateType is "fixed"');
    }
    if (card.hourlyRate != null) {
      throw new Error('hourlyRate must be null when rateType is "fixed"');
    }
    if (card.monthlyTotal != null) {
      throw new Error('monthlyTotal must be null when rateType is "fixed"');
    }
  } else {
    // S21: 'monthly' retainer card.
    if (card.monthlyTotal == null) {
      throw new Error('monthlyTotal is required when rateType is "monthly"');
    }
    if (card.hourlyRate != null) {
      throw new Error('hourlyRate must be null when rateType is "monthly"');
    }
    if (card.fixedTotal != null) {
      throw new Error('fixedTotal must be null when rateType is "monthly"');
    }
  }
}

/**
 * Returns all cards, in Dexie primary-key order. By default archived cards
 * are excluded; pass `includeArchived = true` to include them.
 *
 * NOT for display. Since 001-cards-order-colors every list the user SEES
 * goes through `getCardsOrdered` / `getArchivedCardsOrdered`, which apply
 * her own order. This function and `getArchivedCards` remain for the callers
 * where order is meaningless:
 *
 *   - `lib/sync/snapshot.ts` — the snapshot's array order is `sort by id`;
 *     display order travels in each row's `position`.
 *   - `features/calendar/useEntriesInRange.ts` — builds a `cardsById` map,
 *     so it consumes a set, not a sequence.
 *
 * A new display call site belongs on the ordered helpers instead.
 */
export async function getAllCards(db: HourTrackDB, includeArchived = false): Promise<Card[]> {
  if (includeArchived) {
    return db.cards.toArray();
  }
  // Dexie cannot index booleans as keys reliably across all browsers, so
  // filter in memory. `isArchived` is also indexed for tooling but the
  // filter remains the source of truth.
  return db.cards.filter((c) => !c.isArchived).toArray();
}

/**
 * Convenience wrapper for the archive list (Settings page, S08).
 */
export async function getArchivedCards(db: HourTrackDB): Promise<Card[]> {
  return db.cards.filter((c) => c.isArchived).toArray();
}

/**
 * Cards in the user's chosen order. This is the only sanctioned way to list
 * cards FOR DISPLAY; `getAllCards` / `getArchivedCards` remain for callers
 * that don't render (snapshot writing, integrity checks).
 *
 * `includeArchived` mirrors `getAllCards` — the report filters can show
 * archived cards, and they must obey the same comparator.
 */
export async function getCardsOrdered(db: HourTrackDB, includeArchived = false): Promise<Card[]> {
  const cards = await getAllCards(db, includeArchived);
  return cards.sort(compareCardsForDisplay);
}

/** Archived cards only (Settings -> Card archive), same comparator. */
export async function getArchivedCardsOrdered(db: HourTrackDB): Promise<Card[]> {
  const cards = await getArchivedCards(db);
  return cards.sort(compareCardsForDisplay);
}

export async function getCardById(db: HourTrackDB, id: string): Promise<Card | undefined> {
  return db.cards.get(id);
}

/**
 * What a caller supplies to create a card. `position` is optional: omitted
 * (the UI path) the card is appended to the end of the row; supplied it is
 * honoured verbatim, which is what a Drive-snapshot restore needs.
 */
export type CardCreateInput = Omit<Card, 'createdAt' | 'updatedAt' | 'position'> &
  Partial<Pick<Card, 'position'>>;

export async function createCard(db: HourTrackDB, input: CardCreateInput): Promise<Card> {
  // One `rw` transaction so the "what is the last rank" read and the write
  // that depends on it cannot be interleaved by a second tab. Duplicate
  // ranks are survivable (the `id` tie-break keeps the order total), but a
  // read-modify-write outside a transaction is the exact shape S31/UR-31-4
  // hardened `updateCard` against, and there is no reason to reintroduce it.
  return db.transaction('rw', db.cards, async () => {
    const position = input.position ?? (await nextCardPosition(db));
    const now = nowIso();
    const card: Card = { ...input, position, createdAt: now, updatedAt: now };
    assertCardShape(card);
    await db.cards.add(card);
    return card;
  });
}

/**
 * Apply a partial patch and stamp a fresh `updatedAt`. Throws if the card
 * does not exist, or if the resulting merged shape violates the card
 * invariants (see `assertCardShape`).
 */
export async function updateCard(
  db: HourTrackDB,
  id: string,
  patch: Partial<Omit<Card, 'id' | 'createdAt'>>,
): Promise<Card> {
  // S31 (UR-31-4): get→merge→put runs in ONE `rw` transaction so a concurrent
  // read-modify-write (a sync stamp vs a user edit, cross-tab or during a
  // flush) can't clobber the other's fields (e.g. losing `googleEventId`).
  // IndexedDB serialises readwrite transactions over the store, so each caller
  // bases its merge on the previous caller's committed write. Mirrors
  // `updateSettings` (S29 Task 7).
  return db.transaction('rw', db.cards, async () => {
    const existing = await db.cards.get(id);
    if (!existing) throw new Error(`updateCard: card not found: ${id}`);
    const next: Card = { ...existing, ...patch, id, updatedAt: nowIso() };
    // Only assert the shape if the patch actually touches invariant-bearing
    // fields. This keeps archive/restore reachable for cleanup even when a
    // legacy or Drive-restored card has a stale shape (e.g. an off-palette
    // color introduced by a future palette change in S11 restore).
    const touchesShape =
      'color' in patch ||
      'rateType' in patch ||
      'hourlyRate' in patch ||
      'fixedTotal' in patch ||
      'monthlyTotal' in patch;
    // `position` gets its OWN narrow check rather than joining the list
    // above. A rank cannot conflict with another field, and putting it in
    // `touchesShape` made every restore assert the full shape — which closed
    // the escape hatch this branch exists for: `restoreCard` always writes a
    // position, so a legacy row (an hourly card with no rate, written by
    // `applySnapshot`'s bulkPut from an old backup) could be archived but
    // never restored, and the archive list is the only place the user can
    // act on such a card. Covered by cardOrder.test.ts › "restores a card
    // whose stored shape is legacy-invalid".
    if ('position' in patch && !Number.isFinite(next.position)) {
      throw new Error(`Invalid card position "${next.position}": expected a finite number`);
    }
    if (touchesShape) {
      assertCardShape(next);
    }
    await db.cards.put(next);
    return next;
  });
}

export async function archiveCard(db: HourTrackDB, id: string): Promise<Card> {
  // Archive is a SOFT delete -- the card row stays in Dexie with
  // `isArchived = true`. No tombstone is written: the card is still
  // "alive" from a sync perspective and other devices learn about the
  // archive via the row's updated `isArchived` field + bumped
  // `updatedAt`. Restore is its inverse.
  return updateCard(db, id, { isArchived: true, archivedAt: nowIso() });
}

export async function restoreCard(db: HourTrackDB, id: string): Promise<Card> {
  // Restore also clears any stale tombstone for this card id — covers the
  // edge case where the user hard-deleted, then restored the same id from
  // a backup (S11), then immediately restored from archive. Without this
  // call the tombstone in `data.json` would silently re-delete the card
  // on every other device.
  // A restored card is appended to the end of the row rather than dropped
  // back into whatever slot it held before it was archived — the row has
  // moved on since, and re-appearing in the middle of it reads as a bug
  // (001-cards-order-colors, contracts/card-ordering.md). The rank read and
  // the write share one transaction, as in `createCard`.
  return db.transaction('rw', db.cards, db.tombstones, async () => {
    await clearTombstone(db, id);
    const position = await nextCardPosition(db);
    return updateCard(db, id, { isArchived: false, archivedAt: null, position });
  });
}

/**
 * Hard-delete a card AND every entry that references it. Used by the S08
 * Settings "Delete permanently" affordance.
 *
 * Wrapped in a Dexie transaction so the cascade is atomic — either every
 * table is cleaned up or none is touched. Idempotent: deleting a card that
 * doesn't exist is a no-op (mirrors `db.cards.delete`'s own behavior).
 *
 * S10: writes a tombstone for the card AND one per cascaded entry. Other
 * devices learn about the cascade by replaying tombstones during their next
 * Drive snapshot read.
 *
 * S31 (UR-31-2): the cascade also covers `payments`. Before this, a hard card
 * delete left `Payment.cardId` rows behind — invisible in ledgers
 * (`cardsById.get` is undefined so the row is skipped in `monthLedger`),
 * undeletable from the UI, and re-synced forever. We collect the card's
 * payment ids, delete them, and write one `{ entityType: 'payment' }` tombstone
 * per id so remote devices propagate the same delete. Uses the existing
 * tombstone store — no schema change.
 */
export async function deleteCardPermanently(db: HourTrackDB, id: string): Promise<void> {
  await db.transaction('rw', db.cards, db.entries, db.payments, db.tombstones, async () => {
    const orphanedEntryIds = await db.entries.where('cardId').equals(id).primaryKeys();
    const orphanedPaymentIds = await db.payments.where('cardId').equals(id).primaryKeys();
    const deletedAt = nowIso();
    await db.entries.where('cardId').equals(id).delete();
    await db.payments.where('cardId').equals(id).delete();
    await db.cards.delete(id);
    // Tombstones for the cascade so remote devices propagate the same
    // delete instead of treating the absence as "not yet synced".
    const tombstoneRows: TombstoneRow[] = [
      { entityId: id, entityType: 'card', deletedAt },
      ...orphanedEntryIds.map((entryId): TombstoneRow => ({
        entityId: String(entryId),
        entityType: 'entry',
        deletedAt,
      })),
      ...orphanedPaymentIds.map((paymentId): TombstoneRow => ({
        entityId: String(paymentId),
        entityType: 'payment',
        deletedAt,
      })),
    ];
    if (tombstoneRows.length > 0) {
      await db.tombstones.bulkPut(tombstoneRows);
    }
  });
}
