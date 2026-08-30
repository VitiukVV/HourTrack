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
 *   4. If `onBack` did NOT close the modal (a dirty form answers with a
 *      "Discard changes?" confirm and stays open), push the marker again —
 *      the browser has already spent the entry, and a second back press would
 *      otherwise leave the page with the editor still open.
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

/**
 * Push one history entry carrying this modal's marker.
 *
 * The marker is MERGED into whatever state is already there rather than
 * replacing it. React Router keeps its own bookkeeping in `history.state`
 * (`idx`, `key`, `usr`), and it re-reads `idx` from the live state on every
 * push and every pop. An entry without `idx` makes the router's POP delta come
 * out `null`/`NaN`, and any `navigate()` made from INSIDE an open modal (the
 * day picker does exactly that) then writes `idx: NaN` forward — after which
 * the browser's back button quietly stops reaching the router at all.
 *
 * `idx` is INCREMENTED because this genuinely is a new position in the stack.
 */
function pushMarker(id: number): void {
  const current = (window.history.state ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current, __modalId: id };
  if (typeof current.idx === 'number') next.idx = current.idx + 1;
  window.history.pushState(next, '');
}

/** One modal's live guard: its marker id and whether the entry is still up. */
interface GuardEntry {
  id: number;
  pushed: boolean;
}

export function useModalBackButton(active: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  const entryRef = useRef<GuardEntry | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof window === 'undefined') return;

    const entry: GuardEntry = { id: ++modalIdCounter, pushed: true };
    entryRef.current = entry;
    // `pushState` adds a new entry on top of the browser history without
    // changing the URL — the user's address bar stays put while we get a
    // back-able state to consume.
    pushMarker(entry.id);

    const handlePopState = () => {
      // After back-button: history.state is the *new* top. If it's no longer
      // our marker, the user popped past us → trigger close. If it's still
      // ours (e.g. a sibling/nested modal popped its own state), we no-op.
      if (isModalMarker(window.history.state, entry.id)) return;
      // The browser already consumed our entry — don't pop it again on cleanup.
      entry.pushed = false;
      onBackRef.current();
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (entryRef.current === entry) entryRef.current = null;
      // Modal closed by a UI action (Save / Cancel / X) — our marker is still
      // on top of history. Pop it so the user's back button doesn't land on
      // a "ghost" entry that feels like a no-op. If the marker is NOT on
      // top, the modal closed *because* of a popstate (back-button) and the
      // entry is already gone — nothing to do.
      if (entry.pushed && isModalMarker(window.history.state, entry.id)) {
        entry.pushed = false;
        window.history.back();
      }
    };
  }, [active]);

  // RE-ARM — a back press whose `onBack` did NOT close the modal.
  //
  // `EntryEditModal` answers a close request on a dirty form by opening the
  // "Discard changes?" confirm and staying open. The browser has already eaten
  // our history entry by then, so without re-pushing it the NEXT back press
  // walks straight out of the page with the editor still on screen.
  //
  // Deliberately has no dependency array: it has to notice the moment the
  // consumer re-renders still-open, whatever caused it. It is a ref read and a
  // boolean check on every other render.
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const entry = entryRef.current;
    if (!entry || entry.pushed) return;
    entry.pushed = true;
    pushMarker(entry.id);
  });
}
