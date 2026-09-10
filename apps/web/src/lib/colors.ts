/**
 * Card color: the 12 presets, the label-contrast rule, and the mapping into
 * Google Calendar `colorId` values.
 *
 * `Card.color` is an OPEN hex field — any `#RRGGBB` is valid. The 12 values
 * below are *presets*: the two-tap choice offered first in the picker, and the
 * hexes with a hand-curated Calendar mapping. Their values and their order are
 * still a contract (the picker renders them in this order, and
 * GOOGLE_CALENDAR_COLOR_MAP keys on them); they are no longer the set of
 * permitted colors. PROJECT_PLAN.md §7.5 is the canonical source.
 *
 * S19 (UR-19-2) curated the presets for 12-way contrast as full-background
 * pills, replacing a palette whose near-duplicates (green/emerald,
 * stone/slate) made two cards hard to tell apart side by side.
 *
 * 001-cards-order-colors changed two things about color, both deliberate and
 * both user-approved (spec FR-009a, FR-010a, FR-010b):
 *
 *   1. `getReadableTextColor` now compares real WCAG contrast ratios instead
 *      of thresholding luminance. Six presets (orange, amber, banana, lime,
 *      basil, teal) consequently render a DARK label where they used to render
 *      white. That visible change bought every preset a label at >= 4.5:1.
 *   2. Sky moved from `#0284C7` to `#0C74B0`. The old hex could not reach
 *      4.5:1 with EITHER label (4.10 white / 4.36 dark), so it was the one
 *      preset the rule above could not rescue. Cards holding the old value are
 *      migrated by Dexie `version(9)`. The retired hex still resolves to
 *      Peacock via nearest-neighbour, so a device that has not upgraded yet
 *      keeps the Calendar color it always had.
 *
 * A color outside the presets (custom pick, or a pre-S19 legacy hex) is fully
 * supported: the picker offers it back as the selected swatch, and the
 * Calendar mapping falls through to nearest-neighbour resolution.
 */

export const CARD_COLORS = [
  '#DC2626', // Tomato (red)
  '#EA580C', // Orange
  '#D97706', // Amber
  '#CA8A04', // Banana (yellow)
  '#65A30D', // Lime / Sage
  '#16A34A', // Basil (green)
  '#0D9488', // Teal
  '#0C74B0', // Sky — corrected from #0284C7, which failed 4.5:1 either way
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
 *     - `#0C74B0` Sky     → 7 (Peacock)            ← shares with Teal
 *     - `#7C3AED` Violet  → 3 (Grape)
 *     - `#C026D3` Fuchsia → 3 (Grape)              ← shares with Violet
 *
 *   - Slots `1` (Lavender) and `8` (Graphite) are intentionally unused —
 *     too washed-out vs the bolder S19 palette. Do NOT "fix" the unused
 *     slots by re-routing a vivid hex there; the choice is on purpose.
 *     `resolveCalendarColorId` MAY still return them for a custom color that
 *     genuinely sits closest to them — that is resolution, not a re-route.
 *
 * Every hex in CARD_COLORS MUST have an entry here (enforced by colors.test.ts).
 * A color that is NOT a preset does not belong here — it resolves through
 * `resolveCalendarColorId` instead.
 */
export const GOOGLE_CALENDAR_COLOR_MAP: Record<string, string> = {
  '#DC2626': '11', // Tomato
  '#EA580C': '6', // Tangerine (Orange)
  '#D97706': '6', // Tangerine (Amber) — collision with Orange (intentional)
  '#CA8A04': '5', // Banana
  '#65A30D': '2', // Sage
  '#16A34A': '10', // Basil
  '#0D9488': '7', // Peacock (Teal)
  '#0C74B0': '7', // Peacock (Sky) — collision with Teal (intentional)
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

/** The two label colors a card pill may use. */
const LABEL_LIGHT = '#FFFFFF';
const LABEL_DARK = '#0F172A';

/** WCAG AA threshold for normal-size text. */
export const LABEL_CONTRAST_THRESHOLD = 4.5;

/**
 * Syntactic guard for the open `Card.color` field: is this a `#RRGGBB` hex?
 *
 * Distinct from `isValidCardColor`, which asks the narrower question "is this
 * one of the 12 presets?". Validation at the form, the DB write boundary and
 * the snapshot parser all use THIS one, because a custom color is legal.
 */
export function isValidHexColor(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

/** `#RRGGBB` (or bare `RRGGBB`) → `[r, g, b]`, or null when unparseable. */
function toRgb(hex: string): [number, number, number] | null {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) return null;
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

/** sRGB channel (0..255) → linear-light, the standard inverse-gamma curve. */
function toLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance per ITU-R BT.709. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio between two luminances, always >= 1. */
function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The two label colours as luminances. Constant, so measured once here rather
 * than re-derived from their hexes on every pill that renders.
 */
const LABEL_LIGHT_LUMINANCE = relativeLuminance([0xff, 0xff, 0xff]); // #FFFFFF
const LABEL_DARK_LUMINANCE = relativeLuminance([0x0f, 0x17, 0x2a]); // #0F172A

/**
 * The label color for a pill background, plus the contrast ratio it achieves.
 *
 * Picks whichever of the two label colors genuinely contrasts more with the
 * background, measured as a WCAG ratio — not by thresholding luminance, which
 * is what this file used to do and what left six presets on a white label
 * they could not carry (see the file header).
 *
 * The ratio is returned so the color picker can advise the user when a custom
 * color cannot reach `LABEL_CONTRAST_THRESHOLD` with either label. That is
 * advice, never a block: the user may keep the color (spec FR-009c).
 *
 * Malformed input yields the dark label and its ratio against white, so a
 * corrupted value still renders something legible rather than throwing.
 */
export function getLabelContrast(hex: string): {
  color: typeof LABEL_LIGHT | typeof LABEL_DARK;
  ratio: number;
} {
  const rgb = toRgb(hex);
  if (rgb === null) {
    // Nothing to measure against, so report the dark label's ratio on white
    // — what it would score on the page's own background.
    return { color: LABEL_DARK, ratio: contrastRatio(LABEL_LIGHT_LUMINANCE, LABEL_DARK_LUMINANCE) };
  }
  const background = relativeLuminance(rgb);
  const againstLight = contrastRatio(background, LABEL_LIGHT_LUMINANCE);
  const againstDark = contrastRatio(background, LABEL_DARK_LUMINANCE);
  return againstDark > againstLight
    ? { color: LABEL_DARK, ratio: againstDark }
    : { color: LABEL_LIGHT, ratio: againstLight };
}

/**
 * Pick `'#FFFFFF'` (white) or `'#0F172A'` (dark slate) text for a given
 * background hex so the pair is readable.
 *
 * Every card surface renders `card.color` as its background fill (S19
 * UR-19-4), so the foreground has to be derived rather than fixed. Accepts
 * any 6-digit hex with or without the leading `#`; malformed input returns
 * `'#0F172A'` as a safe default.
 */
export function getReadableTextColor(hex: string): typeof LABEL_LIGHT | typeof LABEL_DARK {
  return getLabelContrast(hex).color;
}

/**
 * Google Calendar's eleven event colors, keyed by `colorId`.
 *
 * Provenance: Google's documented event palette, as returned by
 * `GET /calendar/v3/colors` (`event` section). Frozen here rather than
 * fetched at runtime — the values are stable, and a network call on every
 * event build would be absurd. Re-verify if Google ever re-tints the palette.
 *
 * NOT yet re-verified against a live response (2026-09-10): that call needs an
 * authenticated client, which the dev environment does not have. The values
 * come from Google's published palette. If a custom color ever maps to a
 * visibly wrong Calendar color, check these hexes against a live
 * `GET /calendar/v3/colors` first.
 */
export const GOOGLE_EVENT_COLORS: Readonly<Record<string, string>> = {
  '1': '#7986CB', // Lavender
  '2': '#33B679', // Sage
  '3': '#8E24AA', // Grape
  '4': '#E67C73', // Flamingo
  '5': '#F6BF26', // Banana
  '6': '#F4511E', // Tangerine
  '7': '#039BE5', // Peacock
  '8': '#616161', // Graphite
  '9': '#3F51B5', // Blueberry
  '10': '#0B8043', // Basil
  '11': '#D50000', // Tomato
};

/** sRGB → CIELAB (D65). Enough for nearest-color selection among 11 targets. */
function toLab([r, g, b]: [number, number, number]): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  // linear sRGB → CIE XYZ (D65), then XYZ → Lab.
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * `GOOGLE_EVENT_COLORS` pre-converted to CIELAB, in ascending numeric id
 * order so an exact ΔE tie resolves to the lower id and the resolver stays
 * deterministic. Built once: the ids were being re-sorted and every target
 * colour re-converted on every event build.
 *
 * The `toRgb` cast is safe by construction: every value above is a literal
 * `#RRGGBB` written in this file.
 */
const GOOGLE_EVENT_LAB: ReadonlyArray<{ id: string; lab: [number, number, number] }> =
  Object.entries(GOOGLE_EVENT_COLORS)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, colorHex]) => ({ id, lab: toLab(toRgb(colorHex) as [number, number, number]) }));

/**
 * Resolve any card color to a Google Calendar `colorId`.
 *
 * - One of the 12 presets → its curated mapping, collisions and all. Those
 *   choices are hand-made (Lavender and Graphite deliberately unused) and a
 *   distance function would happily undo them.
 * - Any other valid hex → the nearest Google event color by CIELAB ΔE76,
 *   ties broken by ascending `colorId` so the function is fully deterministic.
 *   This replaces the old `?? '8'` fallback, which silently turned every
 *   non-preset color into Graphite grey.
 * - Malformed hex → `'8'` (Graphite), the last-resort guard.
 *
 * The curated lookup is case-INSENSITIVE. Its keys are the uppercase presets,
 * but nothing normalises `Card.color` on the way in: the native colour input
 * yields lowercase, and neither `assertCardShape` nor the snapshot parser
 * changes case. A case-sensitive lookup therefore sent `#0d9488` down the
 * nearest-neighbour path, and the approximation disagrees with the curated
 * choice — teal resolved to Sage, and basil and lime swapped. Same colour,
 * same slot, whatever the spelling.
 */
export function resolveCalendarColorId(hex: string): string {
  const curated = GOOGLE_CALENDAR_COLOR_MAP[hex.toUpperCase()];
  if (curated !== undefined) return curated;

  const rgb = toRgb(hex);
  if (rgb === null) {
    // A colour that is not a hex at all should never reach here: the form,
    // `assertCardShape` and the snapshot parser all reject one. Say so —
    // a grey Calendar event is the visible symptom of a row that skipped
    // every one of those gates, and it is not self-explanatory.
    console.error(
      `[colors] resolveCalendarColorId: malformed card color "${hex}" — using graphite`,
    );
    return '8';
  }

  const [l1, a1, b1] = toLab(rgb);
  let bestId = '8';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const { id, lab } of GOOGLE_EVENT_LAB) {
    const [l2, a2, b2] = lab;
    const distance = Math.hypot(l1 - l2, a1 - a2, b1 - b2);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = id;
    }
  }
  return bestId;
}
