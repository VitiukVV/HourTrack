import { forwardRef, useCallback, type MouseEvent } from 'react';
import { Check } from 'lucide-react';

import type { Card } from '@hourtrack/shared-types';

import { useLongPress } from '@/hooks/useLongPress';
import { getReadableTextColor } from '@/lib/colors';
import { cn } from '@/lib/utils';

interface CardChipProps {
  card: Card;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Optional test-id forwarded onto the rendered `<button>` (S13 onboarding anchor). */
  'data-testid'?: string;
}

/**
 * Pill button representing a single Card in the header carousel.
 *
 * S19 (UR-19-4 + UR-19-5): the chip's background IS the card color now —
 * no leading dot — and the chip is constrained to a roughly 6-character
 * width so a row of chips reads as a tidy carousel of same-size pills.
 * Long names truncate with ellipsis; `title={card.name}` surfaces the
 * full name on hover (desktop) — mobile users see the truncation, which
 * is the right tradeoff for the equal-width goal.
 *
 * S03 followup: `useLongPress(500)` fires `onContextMenu` synthetically on
 * touch pointers so mobile users get the same edit/archive affordance that
 * desktop users get via right-click. Mouse pointers are ignored by the hook —
 * `onContextMenu` already handles them.
 *
 * Accessible name is just the card name so screen readers don't echo "color
 * #...". Active state is exposed via `aria-pressed`.
 */
export const CardChip = forwardRef<HTMLButtonElement, CardChipProps>(function CardChip(
  { card, isActive, onClick, onContextMenu, 'data-testid': testId },
  ref,
) {
  // Re-use the same MouseEvent-shaped contract — long-press fabricates a
  // synthetic ContextMenu event so the parent's handler treats touch + mouse
  // identically. Dispatch on the actual long-pressed element (forwarded by
  // the hook). Using document.activeElement would target whatever happens
  // to be focused (often <body> on a fresh mobile load) instead of this chip.
  const fireContextFromTouch = useCallback((target: HTMLElement) => {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  }, []);
  const longPress = useLongPress(fireContextFromTouch, { delayMs: 500 });

  const textColor = getReadableTextColor(card.color);

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-testid={testId}
      title={card.name}
      {...longPress}
      style={{
        backgroundColor: card.color,
        color: textColor,
      }}
      className={cn(
        // Width band: roughly 6 characters of content, with ellipsis on
        // overflow. `justify-center` centers the name within the band so
        // short and long names both read as equal-width pills.
        // S18 — bump tap height to 44px on `< sm` for the iOS / Material
        // touch-target rule. Desktop keeps the compact pill height.
        'focus-visible:ring-ring inline-flex min-h-[44px] min-w-[5.5rem] max-w-[7rem] items-center justify-center gap-1 truncate whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-[transform,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 sm:min-h-0',
        isActive
          ? 'border-foreground border-2 font-semibold shadow-sm'
          : 'border-transparent opacity-90 hover:opacity-100',
      )}
    >
      <span className="truncate">{card.name}</span>
      {isActive && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
    </button>
  );
});
