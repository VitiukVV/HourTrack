/**
 * Scroll the page back to the top.
 *
 * `window.scrollTo(0, 0)` alone is a NO-OP in this app. `index.css` sets
 * `html, body { height: 100%; overflow-x: hidden }`, and a non-visible
 * `overflow-x` computes `overflow-y` to `auto` — so `<body>` becomes the
 * scroll container and the viewport itself never scrolls. Measured in
 * Chromium: after scrolling the calendar, `window.scrollY === 0` while
 * `document.body.scrollTop === 238`.
 *
 * Rather than reshuffle the global overflow rules (they are the deliberate
 * S22 horizontal-scroll lockdown), reset every candidate scroller — whichever
 * one is live responds, the others are already at 0.
 */
export function scrollPageToTop(): void {
  if (typeof window === 'undefined') return;
  window.scrollTo(0, 0);
  if (typeof document === 'undefined') return;
  if (document.body) document.body.scrollTop = 0;
  if (document.documentElement) document.documentElement.scrollTop = 0;
}
