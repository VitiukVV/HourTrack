import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

import { getPageScroller } from '@/lib/scroll';

/**
 * Restores scroll position on "back".
 *
 * Calendar → a day → back always landed at the top of the month, which on a
 * long month means hunting for the day you just came from. Neither the
 * browser's native restoration nor react-router's `<ScrollRestoration>` fixes
 * it: both drive `window`, and in this app `window` does not scroll. `<body>`
 * does — see `lib/scroll.ts` for the measurement. Scroll events on an element
 * don't bubble either, so the listener is registered on `document` in the
 * CAPTURE phase (same trick as the onboarding tour's spotlight).
 *
 * Positions are keyed by `location.key`, so the same URL visited twice keeps
 * two independent positions, and live in `sessionStorage`: they survive a
 * reload, die with the tab, and never pollute the durable `localStorage` that
 * settings and onboarding use.
 *
 * Ported from my-diary's `src/app/useScrollRestoration.ts`; its
 * `useRestorableLimit` companion is deliberately left behind — no list here is
 * paginated by a "show more" button.
 */

const STORAGE_KEY = 'hourtrack:scroll';
/** Bounded so a long session cannot grow the store without limit. */
const MAX_ENTRIES = 30;
/** How long to keep chasing a position while async content is still mounting. */
const RESTORE_WINDOW_MS = 1000;
const SAVE_THROTTLE_MS = 150;

type Store = Record<string, number>;

function read(): Store {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    const keys = Object.keys(store);
    if (keys.length > MAX_ENTRIES) {
      // Insertion order survives the JSON round-trip, so the oldest keys are
      // simply the first ones.
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete store[k];
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota — scroll memory is a nicety, never a failure */
  }
}

export function saveScroll(key: string, top: number): void {
  const store = read();
  // Re-insert so the key counts as recently used for the cap above.
  delete store[key];
  store[key] = top;
  write(store);
}

export function readScroll(key: string): number | undefined {
  return read()[key];
}

/** Test-only. */
export function __clearScrollStore(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function useScrollRestoration(): void {
  const { key } = useLocation();
  const navigationType = useNavigationType();

  // Own the restoration: the browser's would fight ours on reload.
  useEffect(() => {
    if (typeof window === 'undefined' || !('scrollRestoration' in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  // Track where the user is, and persist it when this history entry is left.
  useEffect(() => {
    const el = getPageScroller();
    if (!el) return;

    let timer: number | null = null;
    // Every scroll event updates this, unthrottled — the throttle governs how
    // often we WRITE, not how well we know where the user is.
    let lastTop: number | null = null;
    const onScroll = (): void => {
      lastTop = el.scrollTop;
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        saveScroll(key, el.scrollTop);
      }, SAVE_THROTTLE_MS);
    };
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });

    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (timer !== null) window.clearTimeout(timer);
      // This cleanup runs AFTER the next route's content is already in the DOM.
      // When that page is shorter than the position we held (a day opened from
      // a long month), the browser has already clamped `scrollTop` to 0 — and
      // writing that 0 is precisely why "back" kept landing at the top. Fall
      // back to the last position we actually observed.
      const top = el.scrollTop;
      const reachable = Math.max(0, el.scrollHeight - el.clientHeight);
      const observed = lastTop;
      const clamped = top === 0 && observed !== null && observed > reachable;
      saveScroll(key, clamped ? observed : top);
    };
  }, [key]);

  // Apply the stored position (or reset to the top on a forward navigation).
  useEffect(() => {
    const el = getPageScroller();
    if (!el) return;

    // Forward navigation always starts at the top; only POP restores.
    if (navigationType !== 'POP') {
      el.scrollTop = 0;
      return;
    }
    const target = readScroll(key);
    if (target === undefined || target === 0) return;

    // Lists mount empty while Dexie loads, so a single-frame restore lands at
    // 0. Keep re-applying while the content grows — but abandon the moment the
    // user touches the page, or the app would yank the view out from under
    // them.
    let cancelled = false;
    const stop = (): void => {
      cancelled = true;
    };
    document.addEventListener('wheel', stop, { passive: true, once: true });
    document.addEventListener('touchstart', stop, { passive: true, once: true });
    document.addEventListener('pointerdown', stop, { passive: true, once: true });

    const deadline = Date.now() + RESTORE_WINDOW_MS;
    let raf = 0;
    const attempt = (): void => {
      if (cancelled) return;
      const node = getPageScroller();
      if (!node) return;
      const max = node.scrollHeight - node.clientHeight;
      node.scrollTop = Math.min(target, Math.max(0, max));
      // Reached it, or ran out of patience.
      if (node.scrollTop >= target || Date.now() > deadline) return;
      raf = requestAnimationFrame(attempt);
    };
    attempt();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('wheel', stop);
      document.removeEventListener('touchstart', stop);
      document.removeEventListener('pointerdown', stop);
    };
  }, [key, navigationType]);
}
