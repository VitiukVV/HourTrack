import { useCallback, useRef, type ReactNode } from 'react';

import { MEDIA_QUERIES, useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

import { useCalendarView } from './calendarStore';
import { useSwipeNavigation, type SwipeDirection } from './useSwipeNavigation';

/**
 * Distance (px) the incoming range slides in from after a committed swipe.
 * Deliberately small: the point is to show WHICH WAY time moved, not to play
 * a full page transition on a surface the user flicks through repeatedly.
 */
const ENTER_OFFSET_PX = 28;

/** Enter-animation duration (ms). */
const ENTER_DURATION_MS = 220;

/** Standard ease-out — fast start, soft landing. */
const ENTER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * S33 — wraps the calendar body (MonthView / WeekView) and turns horizontal
 * flicks into `prev()` / `next()` on `useCalendarView`, so the same gesture
 * pages months in month mode and weeks in week mode.
 *
 * Feedback model:
 *   - While the finger moves, the body trails it (damped, clamped) so the
 *     gesture feels attached to the content instead of firing blind.
 *   - Released below the commit threshold, the body springs back to 0.
 *   - Committed, the store's anchor moves and the incoming range slides in
 *     from the side the user pulled it from.
 *
 * `prefers-reduced-motion: reduce` drops both the live offset and the enter
 * animation — the swipe still navigates, it just changes the range instantly.
 *
 * Gesture recognition (touch/pen only, dnd-kit coexistence, click
 * suppression) lives in `useSwipeNavigation`; this component only owns the
 * visual layer and the wiring to the store.
 */
export function CalendarSwipeArea({ children }: { children: ReactNode }) {
  // `prev` / `next` are immutable store actions — read once, outside the
  // reactive layer (same posture as CalendarHeader).
  const { prev, next } = useCalendarView.getState();
  const reduceMotion = useMediaQuery(MEDIA_QUERIES.reducedMotion);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const playEnter = useCallback(
    (direction: SwipeDirection) => {
      const el = surfaceRef.current;
      // `element.animate` is absent in happy-dom (and any browser without
      // WAAPI) — the navigation itself must not depend on it.
      if (!el || reduceMotion || typeof el.animate !== 'function') return;
      // Swiping left (`next`) pulls the incoming range in from the right.
      const from = direction === 'next' ? ENTER_OFFSET_PX : -ENTER_OFFSET_PX;
      el.animate(
        [
          { transform: `translate3d(${from}px, 0, 0)`, opacity: 0.4 },
          { transform: 'translate3d(0, 0, 0)', opacity: 1 },
        ],
        { duration: ENTER_DURATION_MS, easing: ENTER_EASING },
      );
    },
    [reduceMotion],
  );

  const swipe = useSwipeNavigation({
    onSwipeLeft: next,
    onSwipeRight: prev,
    animate: !reduceMotion,
    onCommit: playEnter,
  });

  return (
    <div
      data-testid="calendar-swipe-area"
      data-swiping={swipe.isSwiping ? 'true' : 'false'}
      // `pan-y` keeps vertical scrolling native (the mobile week agenda is a
      // long list) while the horizontal axis is ours to interpret.
      className="touch-pan-y"
      {...swipe.handlers}
    >
      <div
        ref={surfaceRef}
        className={cn(
          // Only hint the compositor while a gesture is live — a permanent
          // `will-change` would keep the whole grid on its own layer.
          swipe.isSwiping && 'will-change-transform',
          // No transition while the finger is down (the offset must track it
          // 1:1); on release the spring-back animates.
          !swipe.isSwiping && !reduceMotion && 'transition-transform duration-200 ease-out',
        )}
        style={swipe.offset === 0 ? undefined : { transform: `translate3d(${swipe.offset}px,0,0)` }}
      >
        {children}
      </div>
    </div>
  );
}
