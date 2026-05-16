/**
 * Card color palette (12 fixed hex values, NOT a free picker) and the
 * mapping into Google Calendar `colorId` values.
 *
 * The 12 hex values + their order are part of the public contract of the
 * data model -- changing them is a breaking change. PROJECT_PLAN.md §7.5
 * is the canonical source; this file MUST mirror it exactly.
 *
 * S19 refresh (locked per chat 16/05/2026 / UR-19-2): the palette was
 * replaced with 12 contrasting hex values. The old palette had near-duplicates
 * (green/emerald, stone/slate) that made it hard to tell two cards apart at
 * a glance once they sat side-by-side as full-bg pills (UR-19-4). The new
 * palette is curated for 12-way contrast in the new bg-color treatment.
 *
 * Migration: existing cards keep their legacy hex. ColorPicker exposes the
 * old hex as a "legacy" swatch when editing; on save with a new-palette
 * choice the card normalises. See S19 spec Part B Task 8.
 */

export const CARD_COLORS = [
  '#DC2626', // Tomato (red)
  '#EA580C', // Orange
  '#D97706', // Amber
  '#CA8A04', // Banana (yellow)
  '#65A30D', // Lime / Sage
  '#16A34A', // Basil (green)
  '#0D9488', // Teal
  '#0284C7', // Sky
  '#2563EB', // Blueberry (blue)
  '#7C3AED', // Grape (violet)
  '#C026D3', // Fuchsia
  '#DB2777', // Flamingo (pink)
] as const;

/** Type of every entry in CARD_COLORS -- useful for prop typing. */
export type CardColor = (typeof CARD_COLORS)[number];

/**
 * Mapping from CARD_COLORS hex to Google Calendar `colorId` (string "1".."11").
 *
 * Google's palette has only 11 colorId slots, so a 12-color palette must
 * accept at least one collision. Locked decision (S19):
 *
 *   - 3 deliberate collisions among visually-adjacent hues:
 *     - `#EA580C` Orange  → 6 (Tangerine)
 *     - `#D97706` Amber   → 6 (Tangerine)          ← shares with Orange
 *     - `#0D9488` Teal    → 7 (Peacock)
 *     - `#0284C7` Sky     → 7 (Peacock)            ← shares with Teal
 *     - `#7C3AED` Violet  → 3 (Grape)
 *     - `#C026D3` Fuchsia → 3 (Grape)              ← shares with Violet
 *
 *   - Slots `1` (Lavender) and `8` (Graphite) are intentionally unused —
 *     too washed-out vs the bolder S19 palette. Do NOT "fix" the unused
 *     slots by re-routing a vivid hex there; the choice is on purpose.
 *
 * Every hex in CARD_COLORS MUST have an entry here (enforced by colors.test.ts).
 */
export const GOOGLE_CALENDAR_COLOR_MAP: Record<string, string> = {
  '#DC2626': '11', // Tomato
  '#EA580C': '6', // Tangerine (Orange)
  '#D97706': '6', // Tangerine (Amber) — collision with Orange (intentional)
  '#CA8A04': '5', // Banana
  '#65A30D': '2', // Sage
  '#16A34A': '10', // Basil
  '#0D9488': '7', // Peacock (Teal)
  '#0284C7': '7', // Peacock (Sky) — collision with Teal (intentional)
  '#2563EB': '9', // Blueberry
  '#7C3AED': '3', // Grape (Violet)
  '#C026D3': '3', // Grape (Fuchsia) — collision with Violet (intentional)
  '#DB2777': '4', // Flamingo
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

/**
 * Pick `'#FFFFFF'` (white) or `'#0F172A'` (dark slate) text for a given
 * background hex so the pair is readable. Uses a simple relative-luminance
 * threshold (Y > 0.5 → dark text).
 *
 * S19 (UR-19-4): every card surface now renders `card.color` as the
 * background fill, so we need to pick a foreground that doesn't disappear.
 * A WCAG-grade contrast helper exists but is overkill for a 12-color palette
 * where every choice was tested by hand; if a future palette change breaks
 * contrast on a swatch, fix the swatch, not the helper.
 *
 * Accepts any 6-digit hex (`#RRGGBB`); throws no error on malformed input —
 * returns `'#0F172A'` (dark) as a safe default. Callers should ensure they
 * pass a normalised hex; this function exists for runtime safety on legacy
 * cards (Task 8) whose hex may not be in CARD_COLORS.
 */
export function getReadableTextColor(hex: string): '#FFFFFF' | '#0F172A' {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  if (normalized.length !== 6) return '#0F172A';
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((c) => Number.isNaN(c))) return '#0F172A';
  // sRGB → linear → Y (relative luminance) per ITU-R BT.709 / WCAG.
  // sRGB channels are gamma-encoded; the inverse-gamma piecewise function
  // below is the standard formula. Threshold of 0.5 on Y picks dark text
  // for "light" backgrounds (Y > 0.5) and white text for "dark" backgrounds.
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const y = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return y > 0.5 ? '#0F172A' : '#FFFFFF';
}
