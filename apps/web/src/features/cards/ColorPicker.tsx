import { useTranslation } from 'react-i18next';

import { CARD_COLORS, isValidCardColor, type CardColor } from '@/lib/colors';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  value: string;
  onChange: (color: CardColor | string) => void;
  /** Optional id to wire up `aria-labelledby` from the surrounding form field. */
  id?: string;
}

/**
 * Renders the 12 sanctioned card colors as a grid of round, focusable
 * buttons. Selection is communicated via `aria-pressed`. No free-form hex
 * input is offered — per PROJECT_PLAN.md §7.5 / UR #24 the palette is closed.
 *
 * Layout: 6×2 on mobile, 12×1 on wider screens. Each button is 36px to meet
 * the WCAG target-size minimum without dominating the form.
 *
 * S08: aria-label is now i18n'd via `t('cards.color')` instead of the
 * hardcoded English string (S03 followup).
 *
 * S19 Task 8 — legacy swatch row: when the supplied `value` is NOT in the
 * new-palette `CARD_COLORS`, we render an extra 13th swatch BEFORE the
 * palette grid showing the legacy hex marked with `(legacy)` in the aria
 * label and a visible `*` overlay. Picking it keeps the legacy color;
 * picking any palette swatch normalises the card. Once normalised, the
 * legacy swatch disappears on next mount. This is the deferred-migration
 * pathway from S19 Notes.
 */
export function ColorPicker({ value, onChange, id }: ColorPickerProps) {
  const { t } = useTranslation();
  const isLegacy = value !== '' && !isValidCardColor(value);

  return (
    <div
      id={id}
      role="group"
      aria-label={t('cards.color')}
      className={cn('flex flex-col gap-2', isLegacy && 'gap-3')}
    >
      {isLegacy && (
        <div className="flex items-center gap-2">
          <button
            key={`legacy-${value}`}
            type="button"
            aria-label={`color ${value} (legacy)`}
            aria-pressed={true}
            onClick={() => onChange(value)}
            className={cn(
              'focus-visible:ring-ring relative h-9 min-h-[44px] w-9 min-w-[44px] rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:min-h-0 sm:min-w-0',
              'ring-foreground border-white ring-2 ring-offset-2',
            )}
            style={{ backgroundColor: value }}
          >
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black shadow"
            >
              *
            </span>
          </button>
          <span className="text-muted-foreground text-xs">
            {/* The "*" mark in the swatch + this caption signal that the */}
            {/* card carries a legacy color; pick any palette swatch below */}
            {/* to normalise. Intentionally not i18n'd as a dedicated key — */}
            {/* the visual mark + aria-label carry the meaning. */}
            (legacy)
          </span>
        </div>
      )}
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
        {CARD_COLORS.map((hex) => {
          const isSelected = value === hex;
          return (
            <button
              key={hex}
              type="button"
              aria-label={`color ${hex}`}
              aria-pressed={isSelected}
              onClick={() => onChange(hex)}
              className={cn(
                // S18 — `min-h-[44px] min-w-[44px]` for the iOS/Material
                // 44px touch-target rule on phones, falling back to the
                // legacy 36px on `sm:+`. Use min-* rather than h-/w-* so
                // the visual swatch size on desktop is unchanged.
                'focus-visible:ring-ring h-9 min-h-[44px] w-9 min-w-[44px] rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:min-h-0 sm:min-w-0',
                isSelected
                  ? 'ring-foreground border-white ring-2 ring-offset-2'
                  : 'border-transparent hover:scale-110',
              )}
              style={{ backgroundColor: hex }}
            />
          );
        })}
      </div>
    </div>
  );
}
