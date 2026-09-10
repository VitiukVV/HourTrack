import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent } from 'react';
import { Check } from 'lucide-react';

import type { Card } from '@hourtrack/shared-types';

import { getReadableTextColor } from '@/lib/colors';
import { cn } from '@/lib/utils';

interface CardChipProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'onContextMenu' | 'style'
> {
  card: Card;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: MouseEvent<HTMLButtonElement>) => void;
  /**
   * 001-cards-order-colors — true while this chip is the one being dragged.
   * Drives the lift feedback (raised + slightly scaled) so the press that
   * started the drag is unmistakably registered. The chip stays
   * presentational: `SortableCardChip` owns the dnd-kit state.
   */
  isDragging?: boolean;
  /** Transform / transition supplied by the sortable wrapper. */
  style?: CSSProperties;
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
 * Long-press → contextmenu was removed per user request: on mobile, the
 * 3-dot dropdown next to the carousel (`cards-header-active-menu-trigger`)
 * is the dedicated edit/archive affordance. The legacy long-press fired
 * the same menu via a fabricated `contextmenu` event, which surprised
 * users who tap-and-hold to start a drag-scroll on the carousel. Desktop
 * right-click (`onContextMenu`) still surfaces the Radix ContextMenu.
 *
 * Accessible name is just the card name so screen readers don't echo "color
 * #...". Active state is exposed via `aria-pressed`.
 */
export const CardChip = forwardRef<HTMLButtonElement, CardChipProps>(function CardChip(
  {
    card,
    isActive,
    onClick,
    onContextMenu,
    isDragging = false,
    style,
    'data-testid': testId,
    ...buttonProps
  },
  ref,
) {
  const textColor = getReadableTextColor(card.color);

  return (
    <button
      ref={ref}
      // The sortable wrapper's dnd-kit attributes land FIRST on purpose:
      // dnd-kit contributes its own `aria-pressed` (undefined unless the
      // chip is mid-drag), which would otherwise wipe out the toggle state
      // this chip actually exposes — the row would stop telling screen
      // readers which card is active.
      {...buttonProps}
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-testid={testId}
      data-dragging={isDragging ? 'true' : undefined}
      title={card.name}
      style={{
        ...style,
        backgroundColor: card.color,
        color: textColor,
      }}
      className={cn(
        // Width band: roughly 6 characters of content, with ellipsis on
        // overflow. `justify-center` centers the name within the band so
        // short and long names both read as equal-width pills.
        // S18 — bump tap height to 44px on `< sm` for the iOS / Material
        // touch-target rule. Desktop keeps the compact pill height.
        // The transition is `motion-safe:` because the chip animates during
        // a reorder: `SortableCardChip` already drops dnd-kit's inline
        // layout-shift transition under `prefers-reduced-motion`, and this
        // class would otherwise keep animating the lift and the neighbours
        // anyway — half-honouring the preference is the same as ignoring it.
        'focus-visible:ring-ring inline-flex min-h-[44px] max-w-[7rem] min-w-[5.5rem] items-center justify-center gap-1 truncate rounded-full border px-3 py-1.5 text-sm whitespace-nowrap focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none motion-safe:transition-[transform,box-shadow] sm:min-h-0',
        isActive
          ? 'border-foreground border-2 font-semibold shadow-sm'
          : // 001-cards-order-colors (SC-004): the inactive chip used to be
            // `opacity-90`, which blends the card colour with the page
            // behind it — #2563EB rendered as #3B73ED and the white label
            // measured 4.32:1 instead of the 5.17:1 the palette guarantees.
            // The label contrast is computed from the pure hex, so the chip
            // must render the pure hex; the hover affordance is a shadow
            // instead of a colour change. (Caught by axe in
            // e2e/12-card-reorder.spec.ts.)
            'border-transparent hover:shadow-sm',
        // 001-cards-order-colors (FR-014) — the lift. Phase 1 of the drag
        // feedback: the held chip leaves the row's plane, so the press is
        // unmistakably registered. Phase 2 (neighbours opening the target
        // slot) is dnd-kit's own layout shift; phase 3 (commit) is simply
        // this class going away when `isDragging` flips back to false.
        // `touch-none` keeps the browser from claiming the gesture as a
        // scroll once the TouchSensor's hold has activated.
        isDragging && 'z-10 scale-105 touch-none opacity-100 shadow-lg',
      )}
    >
      <span className="truncate">{card.name}</span>
      {isActive && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
    </button>
  );
});
