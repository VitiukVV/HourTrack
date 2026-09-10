import type { MouseEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';

import type { Card } from '@hourtrack/shared-types';

import { MEDIA_QUERIES, useMediaQuery } from '@/lib/hooks/useMediaQuery';

import { CardChip } from './CardChip';

interface SortableCardChipProps {
  card: Card;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Forwarded onto the rendered `<button>` (the S13 onboarding anchor). */
  'data-testid'?: string;
}

/**
 * 001-cards-order-colors — the draggable wrapper around `CardChip`.
 *
 * `CardChip` stays presentational; everything that knows about dnd-kit lives
 * here: the sortable attributes/listeners, the transform, and two details
 * that are easy to get wrong.
 *
 *   1. **The post-drag click is dnd-kit's job, not ours.** A pointer drag
 *      would otherwise end with a `click` on the chip and also toggle the
 *      card active. dnd-kit already prevents that: its pointer sensor adds a
 *      capture-phase `click` listener on `document` for the length of the
 *      drag and removes it 50ms after detaching. This component used to keep
 *      its own "swallow one click" ref on top of that, which never saw the
 *      suppressed click and so never disarmed — it ate the user's NEXT real
 *      tap instead (`e2e/12-card-reorder.spec.ts` › "a click right after a
 *      drag still activates the card" is the regression cage). A gesture
 *      shorter than the sensors' activation constraints never starts a drag,
 *      so its click arrives untouched and still activates the card.
 *   2. **Reduced motion.** dnd-kit's layout-shift transition is the "other
 *      chips move aside" animation. Under `prefers-reduced-motion` the chips
 *      jump straight to their slots instead.
 */
export function SortableCardChip({
  card,
  isActive,
  onClick,
  onContextMenu,
  'data-testid': testId,
}: SortableCardChipProps) {
  const reducedMotion = useMediaQuery(MEDIA_QUERIES.reducedMotion);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

  return (
    <CardChip
      ref={setNodeRef}
      card={card}
      isActive={isActive}
      isDragging={isDragging}
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
          : undefined,
        transition: reducedMotion ? undefined : (transition ?? undefined),
      }}
      {...(testId ? { 'data-testid': testId } : {})}
      {...attributes}
      {...listeners}
    />
  );
}
