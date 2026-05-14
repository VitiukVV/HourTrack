import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Touch-only long-press hook. Returns a small `{onPointerDown, onPointerUp,
 * onPointerLeave, onPointerCancel, onPointerMove}` bundle that callers spread
 * onto an interactive element. After `delayMs` of a continuous `touch`
 * pointer-down without an intervening up / leave / cancel, `onLongPress` fires
 * exactly once.
 *
 * Why touch-only? On desktop we already have `onContextMenu` (right-click)
 * wired into CardChip for the same menu. Firing long-press on mouse pointers
 * would conflict with normal click handling and surface duplicate menus.
 *
 * Carries the S03 follow-up: mobile users now have a path to the
 * Edit / Archive menu on Card chips by pressing-and-holding.
 *
 * The timer is cleared on cleanup so re-renders / unmounts can never leak.
 */
export interface UseLongPressOptions {
  /** Milliseconds the pointer must be held before firing. Default 500. */
  delayMs?: number;
}

export interface UseLongPressHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
}

const DEFAULT_DELAY_MS = 500;
const MOVE_TOLERANCE_PX = 8;

export function useLongPress(
  onLongPress: () => void,
  options: UseLongPressOptions = {},
): UseLongPressHandlers {
  const { delayMs = DEFAULT_DELAY_MS } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const callbackRef = useRef(onLongPress);

  // Keep the latest callback without recreating handlers each render.
  useEffect(() => {
    callbackRef.current = onLongPress;
  }, [onLongPress]);

  const cancel = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
  }, []);

  // Cleanup on unmount.
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') return;
      cancel();
      startPosRef.current = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        callbackRef.current();
      }, delayMs);
    },
    [cancel, delayMs],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') return;
      cancel();
    },
    [cancel],
  );

  const onPointerLeave = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') return;
      cancel();
    },
    [cancel],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') return;
      cancel();
    },
    [cancel],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') return;
      const start = startPosRef.current;
      if (!start || timerRef.current == null) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) {
        cancel();
      }
    },
    [cancel],
  );

  return { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, onPointerMove };
}
