/**
 * Card color palette (12 fixed hex values, NOT a free picker) and the
 * mapping into Google Calendar `colorId` values.
 *
 * The 12 hex values + their order are part of the public contract of the
 * data model -- changing them is a breaking change. PROJECT_PLAN.md §7.5
 * is the canonical source; this file MUST mirror it exactly.
 */

export const CARD_COLORS = [
  '#EF4444', // red
  '#F97316', // orange
  '#EAB308', // yellow
  '#22C55E', // green
  '#10B981', // emerald
  '#06B6D4', // cyan
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#78716C', // stone
  '#0F172A', // slate
] as const;

/** Type of every entry in CARD_COLORS -- useful for prop typing. */
export type CardColor = (typeof CARD_COLORS)[number];

/**
 * Mapping from CARD_COLORS hex to Google Calendar `colorId` (string "1".."11").
 * Google's palette has only 11 slots, so `#0F172A` (slate) falls back to "8"
 * (graphite) -- documented in PROJECT_PLAN.md §7.5.
 *
 * Every hex in CARD_COLORS MUST have an entry here (enforced by colors.test.ts).
 */
export const GOOGLE_CALENDAR_COLOR_MAP: Record<string, string> = {
  '#EF4444': '11', // Tomato -> red
  '#F97316': '6', // Tangerine -> orange
  '#EAB308': '5', // Banana -> yellow
  '#22C55E': '2', // Sage -> green
  '#10B981': '10', // Basil -> emerald
  '#06B6D4': '7', // Peacock -> cyan
  '#3B82F6': '1', // Lavender -> blue
  '#6366F1': '9', // Blueberry -> indigo
  '#8B5CF6': '3', // Grape -> violet
  '#EC4899': '4', // Flamingo -> pink
  '#78716C': '8', // Graphite -> stone
  '#0F172A': '8', // slate -> graphite fallback (no exact match in Google palette)
};

const CARD_COLOR_SET: ReadonlySet<string> = new Set(CARD_COLORS);

/**
 * Runtime guard: is the given string one of the 12 sanctioned card colors?
 * Use this whenever you accept a color from external input (Drive snapshot
 * restore, manual color edit form, etc.).
 */
export function isValidCardColor(hex: string): hex is CardColor {
  return CARD_COLOR_SET.has(hex);
}
