import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * S33 — horizontal swipe navigation for the calendar surface.
 *
 * A left flick moves the calendar forward (next month / next week), a right
 * flick moves it back — mirroring the header's `‹` / `›` buttons. The hook is
 * input-agnostic UI plumbing: it owns gesture recognition + the live drag
 * offset, and the caller decides what "forward"/"back" mean.
 *
 * ## Why touch/pen only
 *
 * `pointerType === 'mouse'` is deliberately ignored. The calendar already
 * binds the mouse to dnd-kit's `MouseSensor` (activation distance 8) for
 * entry drag-to-reschedule; a mouse-driven swipe would race that sensor and
 * make every failed chip drag silently change the month. Desktop users
 * navigate with the header buttons / pickers, which stay untouched.
 *
 * ## Why a swipe never becomes a drag (and vice versa)
 *
 * `useEntryDrag`'s `TouchSensor` activates on a 220 ms press-and-hold with an
 * 8 px tolerance, so a quick flick can't start a drag. The inverse guard is
 * `MAX_HOLD_BEFORE_MOVE_MS`: if the finger sat still past that window before
 * moving, the user is dragging a chip, not swiping the view — the gesture is
 * abandoned before it ever produces an offset.
 *
 * ## Axis lock
 *
 * The first movement past `AXIS_LOCK_PX` decides the axis for the whole
 * gesture. A vertical lock abandons the swipe permanently (so scrolling the
 * mobile week agenda never nudges the view sideways), and the container is
 * expected to carry `touch-action: pan-y` so the browser keeps owning
 * vertical scrolling natively.
 *
 * ## Click suppression
 *
 * Day cells create/delete entries on click. Without `onClickCapture`, a swipe
 * that begins and ends inside one wide cell would fire a click on release and
 * pop the day-picker modal. Any gesture that locked horizontally swallows
 * exactly one subsequent click.
 */

/** Movement (px) on either axis that locks the gesture to that axis. */
const AXIS_LOCK_PX = 10;

/** Distance (px) that always commits a page turn, regardless of speed. */
const COMMIT_DISTANCE_PX = 64;

/** A shorter throw still commits if it was flicked at least this fast (px/ms). */
const FLICK_VELOCITY = 0.45;

/** Minimum distance (px) for the velocity path — guards accidental taps. */
const FLICK_MIN_DISTANCE_PX = 24;

/**
 * If the finger stays put longer than this before its first real movement,
 * the gesture belongs to dnd-kit's press-and-hold drag (220 ms), not to us.
 */
const MAX_HOLD_BEFORE_MOVE_MS = 200;

/** Rubber-band factor — the view trails the finger rather than tracking 1:1. */
const DRAG_DAMPING = 0.45;

/** Clamp for the live offset so the view never slides fully off-screen. */
const MAX_DRAG_PX = 120;

export interface UseSwipeNavigationOptions {
  /** Left flick — the calendar moves forward in time. */
  onSwipeLeft: () => void;
  /** Right flick — the calendar moves back in time. */
  onSwipeRight: () => void;
  /** Ignore all gestures (e.g. while an entry drag is in flight). */
  disabled?: boolean;
  /**
   * When `false`, no live offset is reported (`offset` stays 0) and the
   * caller is expected to skip its transitions. Wired to
   * `prefers-reduced-motion` by `CalendarSwipeArea`.
   */
  animate?: boolean;
  /**
   * Fired the moment a swipe commits, with the direction that was taken —
   * lets the caller play an enter animation for the incoming range.
   */
  onCommit?: (direction: SwipeDirection) => void;
}

export type SwipeDirection = 'next' | 'prev';

export interface UseSwipeNavigationResult {
  /** Spread onto the swipeable container element. */
  handlers: {
    onPointerDown: (event: ReactPointerEvent) => void;
    onPointerMove: (event: ReactPointerEvent) => void;
    onPointerUp: (event: ReactPointerEvent) => void;
    onPointerCancel: (event: ReactPointerEvent) => void;
    onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => void;
  };
  /** Damped horizontal offset in px while the finger is down; 0 otherwise. */
  offset: number;
  /** `true` between the axis lock and the release. */
  isSwiping: boolean;
}

interface GestureState {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  axis: 'none' | 'x' | 'y';
}

export function useSwipeNavigation({
  onSwipeLeft,
  onSwipeRight,
  disabled = false,
  animate = true,
  onCommit,
}: UseSwipeNavigationOptions): UseSwipeNavigationResult {
  const gesture = useRef<GestureState | null>(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const reset = useCallback(() => {
    gesture.current = null;
    setOffset(0);
    setIsSwiping(false);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      suppressClick.current = false;
      if (disabled) return;
      // Mouse is owned by dnd-kit; multi-touch (pinch/zoom) is the browser's.
      if (event.pointerType === 'mouse') return;
      if (event.isPrimary === false) return;
      const now = Date.now();
      gesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: now,
        axis: 'none',
      };
    },
    [disabled],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const g = gesture.current;
      if (!g || g.pointerId !== event.pointerId) return;

      const dx = event.clientX - g.startX;
      const dy = event.clientY - g.startY;

      if (g.axis === 'none') {
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        if (absX < AXIS_LOCK_PX && absY < AXIS_LOCK_PX) return;
        // A finger that lingered before moving is starting a chip drag.
        if (Date.now() - g.startedAt > MAX_HOLD_BEFORE_MOVE_MS) {
          gesture.current = null;
          return;
        }
        if (absY >= absX) {
          // Vertical scroll — hand the gesture back to the browser for good.
          gesture.current = null;
          return;
        }
        g.axis = 'x';
        setIsSwiping(true);
      }

      if (animate) {
        const damped = dx * DRAG_DAMPING;
        setOffset(Math.max(-MAX_DRAG_PX, Math.min(MAX_DRAG_PX, damped)));
      }
    },
    [animate],
  );

  const finish = useCallback(
    (event: ReactPointerEvent, commit: boolean) => {
      const g = gesture.current;
      if (!g || g.pointerId !== event.pointerId) return;

      const horizontal = g.axis === 'x';
      reset();
      if (!horizontal) return;

      // Any horizontal gesture eats the trailing click, committed or not —
      // otherwise a cancelled swipe still opens the day picker on release.
      suppressClick.current = true;
      if (!commit) return;

      const dx = event.clientX - g.startX;
      const distance = Math.abs(dx);
      const elapsed = Math.max(Date.now() - g.startedAt, 1);
      const velocity = distance / elapsed;

      const passed =
        distance >= COMMIT_DISTANCE_PX ||
        (distance >= FLICK_MIN_DISTANCE_PX && velocity >= FLICK_VELOCITY);
      if (!passed) return;

      const direction: SwipeDirection = dx < 0 ? 'next' : 'prev';
      if (direction === 'next') onSwipeLeft();
      else onSwipeRight();
      onCommit?.(direction);
    },
    [onCommit, onSwipeLeft, onSwipeRight, reset],
  );

  const onPointerUp = useCallback((event: ReactPointerEvent) => finish(event, true), [finish]);

  const onPointerCancel = useCallback((event: ReactPointerEvent) => finish(event, false), [finish]);

  const onClickCapture = useCallback(
    (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
    offset,
    isSwiping,
  };
}
