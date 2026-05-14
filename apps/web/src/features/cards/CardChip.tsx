import { forwardRef, type MouseEvent } from 'react';
import { Check } from 'lucide-react';

import type { Card } from '@hourtrack/shared-types';

import { cn } from '@/lib/utils';

interface CardChipProps {
  card: Card;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Pill button representing a single Card in the header carousel. Shows a
 * color dot + the card name; the active state thickens the border and adds a
 * check icon. Right-click (or long-press in S05's mobile follow-up) raises
 * `onContextMenu` so the parent can open an Edit / Archive menu.
 *
 * Accessible name is just the card name so screen readers don't echo "color
 * #...". Active state is exposed via `aria-pressed`.
 */
export const CardChip = forwardRef<HTMLButtonElement, CardChipProps>(function CardChip(
  { card, isActive, onClick, onContextMenu },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        'focus-visible:ring-ring inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
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
