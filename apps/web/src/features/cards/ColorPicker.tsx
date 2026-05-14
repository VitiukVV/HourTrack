import { useTranslation } from 'react-i18next';

import { CARD_COLORS, type CardColor } from '@/lib/colors';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  value: string;
  onChange: (color: CardColor) => void;
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
 */
export function ColorPicker({ value, onChange, id }: ColorPickerProps) {
  const { t } = useTranslation();
  return (
    <div
      id={id}
      role="group"
      aria-label={t('cards.color')}
      className="grid grid-cols-6 gap-2 sm:grid-cols-12"
    >
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
              'focus-visible:ring-ring h-9 w-9 rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              isSelected
                ? 'ring-foreground border-white ring-2 ring-offset-2'
                : 'border-transparent hover:scale-110',
            )}
            style={{ backgroundColor: hex }}
          />
        );
      })}
    </div>
  );
}
