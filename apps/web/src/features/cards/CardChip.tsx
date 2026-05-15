import { forwardRef, useCallback, type MouseEvent } from 'react';
import { Check } from 'lucide-react';

import type { Card } from '@hourtrack/shared-types';

import { useLongPress } from '@/hooks/useLongPress';
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
 * Pill button representing a single Card in the header carousel. Shows a
 * color dot + the card name; the active state thickens the border and adds a
 * check icon. Right-click on desktop OR long-press on touch raises the
 * context-menu surface so the parent can open Edit / Archive.
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

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-testid={testId}
      {...longPress}
      className={cn(
        // S18 — bump tap height to 44px on `< sm` for the iOS / Material
        // touch-target rule. Desktop keeps the compact pill height.
        'focus-visible:ring-ring inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 sm:min-h-0',
        isActive
          ? 'border-foreground bg-secondary text-secondary-foreground border-2 font-medium'
          : 'border-border hover:bg-accent hover:text-accent-foreground bg-background',
      )}
    >
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 rounded-full"
        style={{ backgroundColor: card.color }}
      />
      {card.name}
      {isActive && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
});
