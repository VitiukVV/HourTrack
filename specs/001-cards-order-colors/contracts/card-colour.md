# Contract: Card colour

**Feature**: [../spec.md](../spec.md) | **Research**: [../research.md](../research.md) D4–D6

## Module contract — `apps/web/src/lib/colors.ts`

```ts
/**
 * The twelve presets. Values AND order are a stable contract: the picker
 * renders them in this order and GOOGLE_CALENDAR_COLOR_MAP keys on them.
 * They are no longer the set of *permitted* card colours.
 */
export const CARD_COLORS: readonly string[]; // '#0284C7' → '#0C74B0'

/** Is this hex one of the twelve presets? (unchanged semantics) */
export function isValidCardColor(hex: string): hex is CardColor;

/** Is this a syntactically valid card colour at all? (new) */
export function isValidHexColor(hex: string): boolean; // /^#[0-9A-Fa-f]{6}$/

/**
 * Label colour for a pill background: whichever of '#FFFFFF' / '#0F172A'
 * has the higher WCAG contrast ratio. Malformed input → '#0F172A'.
 * BREAKING vs the previous luminance-threshold rule: seven presets flip
 * from white to dark (see research.md D5).
 */
export function getReadableTextColor(hex: string): '#FFFFFF' | '#0F172A';

/** The same choice, with its ratio, so the picker can warn below 4.5. (new) */
export function getLabelContrast(hex: string): {
  color: '#FFFFFF' | '#0F172A';
  ratio: number;
};

/**
 * Google Calendar colorId for a card colour. (new)
 * - one of the twelve presets → its curated mapping, collisions preserved
 * - any other valid hex       → nearest Google event colour by CIELAB ΔE76,
 *                               ties broken by ascending colorId
 * - malformed hex             → '8'
 */
export function resolveCalendarColorId(hex: string): string; // '1'..'11'
```

`GOOGLE_CALENDAR_COLOR_MAP` keeps its shape and its three deliberate collisions. The Sky
**key** must be renamed from `#0284C7` to `#0C74B0`, keeping the same value `'7'` (Peacock) —
renaming the key is part of the palette change, not an afterthought. The old `#0284C7` then
falls through to nearest-neighbour resolution, which also lands on `'7'`, so a card that
still carries the old hex (pushed from a device on the previous build before it upgrades)
keeps the colour it always had. Slots `1` (Lavender) and `8` (Graphite) stay out of the
curated map, but nearest-neighbour resolution MAY return them for a custom colour — that is
intended, not a leak.

### Google event colours used as distance targets

```
1 Lavender  #7986CB    2 Sage      #33B679    3 Grape     #8E24AA
4 Flamingo  #E67C73    5 Banana    #F6BF26    6 Tangerine #F4511E
7 Peacock   #039BE5    8 Graphite  #616161    9 Blueberry #3F51B5
10 Basil    #0B8043   11 Tomato    #D50000
```

Verified once against `GET /calendar/v3/colors` during implementation, then frozen as a
constant with that provenance recorded in a comment.

## Consumer contract — `features/calendar-sync/buildEvent.ts`

```diff
- const colorId = GOOGLE_CALENDAR_COLOR_MAP[card.color] ?? '8';
+ const colorId = resolveCalendarColorId(card.color);
```

Behaviour change: a card colour outside the presets no longer becomes Graphite grey. Events
for the twelve presets keep their exact current `colorId`, so no existing event changes colour
because of this edit alone.

## UI contract — `features/cards/ColorPicker.tsx`

| Element | Contract |
| --- | --- |
| Preset grid | Unchanged: twelve swatches, 6×2 on mobile / 12×1 from `sm:`, 44px minimum touch target, selection via `aria-pressed` |
| Current-colour swatch | The existing "legacy" swatch generalises to "the card's current colour when it is not a preset" — shown first, marked, selectable, and keeps FR-013 working for pre-S19 colours |
| Custom swatch | Opens a native `<input type="color">` plus a hex text field; accepts `#RRGGBB` case-insensitively and normalises to uppercase. Both controls carry the same 44px minimum touch target as the preset swatches, and the hex field is pre-filled with the card's current colour (FR-009b) |
| Contrast warning | When `getLabelContrast(value).ratio < 4.5`, an inline message appears next to the picker. Advisory only — saving is never blocked (FR-009c) |
| i18n | New keys for the custom swatch label, the hex field label and the warning, in `uk`/`en`/`es` |

## Validation contract

| Layer | Accepts |
| --- | --- |
| `cardSchema.ts` | `/^#[0-9A-Fa-f]{6}$/`, error key `cards.validation.colorInvalid` (existing key reused) |
| `assertCardShape` (`lib/db/queries.ts`) | same regex — the DB write boundary stays the last line of defence |
| `validateSnapshot.ts` | same regex, so a corrupted colour in a restored snapshot is rejected with the existing snapshot-invalid path rather than rendering an unreadable pill |
