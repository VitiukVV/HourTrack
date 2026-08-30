import { useLayoutEffect, type RefObject } from 'react';

/**
 * CSS custom property carrying the live height of the app's sticky top
 * chrome (primary header + CardsHeader when it is mounted). Anything that
 * sticks BELOW the chrome reads it as its own `top` offset instead of
 * hardcoding a rem value.
 */
export const STICKY_CHROME_VAR = '--ht-sticky-chrome' as const;

/**
 * Publish the measured height of the sticky chrome stack onto
 * `<html>` as {@link STICKY_CHROME_VAR}.
 *
 * The hardcoded offsets this replaces (`top-[3.25rem]` on CardsHeader,
 * `top-[6.25rem]` on CalendarHeader) never matched the real heights: the
 * chrome header measures 61px on desktop / 69px on mobile, the cards row
 * 53px / 61px. Scrolled, the cards row sat 9px (17px on mobile) UNDER the
 * opaque chrome header and the calendar header covered its bottom 5px
 * (13px on mobile). Heights vary with viewport, font scaling and how the
 * header's own content wraps, so a fixed value cannot be right everywhere —
 * hence a measured variable.
 *
 * `useLayoutEffect` + `ResizeObserver`: the value is written before paint,
 * and re-written whenever the chrome resizes (route change mounting or
 * unmounting the CardsHeader, viewport rotation, language switch changing
 * the nav width and wrapping a row).
 */
export function useStickyChromeHeight(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const publish = () => {
      document.documentElement.style.setProperty(
        STICKY_CHROME_VAR,
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(STICKY_CHROME_VAR);
    };
  }, [ref]);
}
