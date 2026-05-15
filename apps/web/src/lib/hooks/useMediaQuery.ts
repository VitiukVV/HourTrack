import { useEffect, useState } from 'react';

/**
 * S18 — Subscribe to a `window.matchMedia(query)` and re-render the consumer
 * whenever the match flips. Used to switch between two component
 * implementations based on viewport width (e.g. WeekView grid on `md:+`
 * vs the agenda list on `< md`).
 *
 * Returns `false` during SSR / when `window` is not defined; in a CSR-only
 * app like HourTrack this branch is effectively unreachable but kept as a
 * safety net for any future SSR experiment.
 *
 * Subscription model: prefers `addEventListener('change', ...)` (modern
 * Safari + Chrome + Firefox); falls back to the deprecated `addListener`
 * for ancient WebKit. happy-dom's polyfilled `matchMedia` (see
 * `vitest.setup.ts`) provides both as no-op `vi.fn()`s.
 *
 * Common breakpoints (Tailwind defaults):
 *   - `(max-width: 639px)`  — `< sm` (phones in portrait)
 *   - `(max-width: 767px)`  — `< md` (phones + small tablets portrait)
 *   - `(min-width: 768px)`  — `md:+` (tablets + desktop)
 *   - `(min-width: 1024px)` — `lg:+` (desktop)
 *
 * Example:
 *
 *   const isMobile = useMediaQuery('(max-width: 767px)');
 *   return isMobile ? <AgendaView /> : <GridView />;
 *
 * @param query A standard CSS media query string.
 * @returns `true` iff the document currently matches the query.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    // Re-sync immediately in case the query string changed between renders
    // (most callers pass a literal so this is a no-op, but it's cheap).
    setMatches(mql.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);

    // Prefer the modern API; fall back to the legacy `addListener` only
    // when the modern one isn't present (very old WebKit). `as any` is
    // the pragmatic shape — TypeScript's MediaQueryList lib.dom type union
    // doesn't expose the legacy methods.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = mql as any;
    if (typeof legacy.addListener === 'function') {
      legacy.addListener(onChange);
      return () => legacy.removeListener(onChange);
    }
    return undefined;
  }, [query]);

  return matches;
}

/**
 * Convenience aliases for the breakpoints used across S18 surfaces. Lazy
 * callers can avoid hard-coding the pixel boundaries; refactoring the
 * boundary later only touches this file.
 *
 * Tailwind's `md` breakpoint is `768px` — the agenda/grid switch in
 * WeekView (Task 16) and any other "mobile vs tablet+" branch use this.
 */
export const MEDIA_QUERIES = {
  /** `< sm` — phones in portrait (max-width: 639px). */
  belowSm: '(max-width: 639px)',
  /** `< md` — phones + small tablets in portrait (max-width: 767px). */
  belowMd: '(max-width: 767px)',
  /** `md:+` — tablets + desktop (min-width: 768px). */
  mdUp: '(min-width: 768px)',
} as const;
