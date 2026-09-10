/**
 * Dexie-free constants shared by the card order/colour migration paths
 * (001-cards-order-colors).
 *
 * They live in their own module rather than in `schema.ts` because the Drive
 * snapshot upgrade in `features/backup/validateSnapshot.ts` needs the exact
 * same values, and that module must stay free of the Dexie singleton — it
 * runs before any database is opened. `schema.ts` re-exports them, so the
 * established `from './schema'` import path keeps working.
 */

/**
 * Gap between consecutive card `position` ranks when they are seeded or
 * renormalised. A move writes the midpoint of its new neighbours, so a gap of
 * 1024 absorbs ~10 successive inserts into the same slot before the ranks get
 * too close to split and `reorderCard` renormalises the whole row.
 */
export const CARD_POSITION_SPACING = 1024;

/**
 * The sky-blue preset as it was before 001-cards-order-colors. It could not
 * reach a 4.5:1 label contrast with either label colour, so the Dexie v9
 * upgrade and the snapshot v5->v6 upgrade both rewrite it.
 */
export const RETIRED_SKY_BLUE = '#0284C7';

/** Its replacement — see `CARD_COLORS` in `lib/colors.ts`. */
export const CORRECTED_SKY_BLUE = '#0C74B0';
