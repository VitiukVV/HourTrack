import { useEffect, useRef } from 'react';

/**
 * S22 — Wire the OS / browser **back gesture** to a modal's close handler.
 *
 * On Android, hitting the system back button (or the bottom edge-swipe
 * "back" gesture) calls `history.back()`. iOS Safari behaves the same way
 * for the left-edge swipe-back gesture, as does any desktop browser's back
 * button. Without intervention the user lands on the previous *route*
 * (or leaves the PWA entirely) instead of closing the currently-open modal —
 * which is the same disorienting experience as a native app that "exits"
 * when you intended "go back one screen".
 *
 * This hook installs the standard PWA workaround:
 *
 *   1. When `active` flips to `true`, push a marker history state.
 *   2. Listen for `popstate`. If our marker is no longer on top, that means
 *      the user pressed back → call `onBack` (which typically routes through
 *      the modal's `onOpenChange(false)` and any "should we really close?"
 *      logic like EntryEditModal's dirty-discard confirm).
 *   3. When `active` flips back to `false` because of a UI action (Save,
 *      Cancel, X-button), pop the marker state ourselves so the user's
 *      history doesn't grow a stale "modal was here" entry — pressing back
 *      from outside the modal would otherwise feel like a no-op.
 *
 * Nested modals (e.g. EntryEditModal → discard-confirm) work via the LIFO
 * history stack: each modal pushes its own marker; back-button pops the
 * top-most one first; each hook instance checks `history.state.__modalId`
 * against ITS OWN id, so only the modal whose marker was actually popped
 * fires `onBack`. The other listeners no-op because their markers are
 * still in place.
 *
 * Notes:
 * - The hook is no-op when `active` is `false`, so existing modal call-sites
 *   keep their lifecycle: open → push, close → pop, no state in between.
 * - `onBack` is read via a ref so the consumer can pass a fresh closure on
 *   every render without re-running the push/pop effect.
 * - On SSR / non-browser environments (`window` undefined) the hook short-
 *   circuits. HourTrack is CSR-only but the guard keeps the hook portable.
 *
 * @param active  Whether the modal is currently open. The hook installs its
 *                listener when this is `true` and tears it down otherwise.
 * @param onBack  Called when the user presses back / swipes-back while the
 *                modal is open. Callers should treat this as "user requested
 *                close" — same surface as the X button or Esc key — and run
 *                any pre-close logic before actually closing.
 */
let modalIdCounter = 0;

interface ModalMarker {
  __modalId: number;
}

function isModalMarker(value: unknown, id: number): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return (value as ModalMarker).__modalId === id;
}

export function useModalBackButton(active: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active) return;
    if (typeof window === 'undefined') return;

    const id = ++modalIdCounter;
    const marker: ModalMarker = { __modalId: id };
    // `pushState` adds a new entry on top of the browser history without
    // changing the URL — the user's address bar stays put while we get a
    // back-able state to consume.
    window.history.pushState(marker, '');

    const handlePopState = () => {
      // After back-button: history.state is the *new* top. If it's no longer
      // our marker, the user popped past us → trigger close. If it's still
      // ours (e.g. a sibling/nested modal popped its own state), we no-op.
      if (!isModalMarker(window.history.state, id)) {
        onBackRef.current();
      }
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      // Modal closed by a UI action (Save / Cancel / X) — our marker is still
      // on top of history. Pop it so the user's back button doesn't land on
      // a "ghost" entry that feels like a no-op. If the marker is NOT on
      // top, the modal closed *because* of a popstate (back-button) and the
      // entry is already gone — nothing to do.
      if (isModalMarker(window.history.state, id)) {
        window.history.back();
      }
    };
  }, [active]);
}
