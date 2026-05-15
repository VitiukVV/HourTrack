// S16 -- pin the test runner's timezone BEFORE any imports run. Some date
// libs (and `Intl.DateTimeFormat().resolvedOptions().timeZone`) latch the
// host TZ at module init time, so a setting placed below the imports would
// be too late. Without this pin, S16b's `buildEvent` tests assert on
// `start.timeZone === 'Europe/Kyiv'` and would flake against any CI runner
// or contributor machine whose host TZ differs from Kyiv (CI is UTC, devs
// vary). Pinning here makes every Calendar-payload test deterministic.
process.env.TZ = 'Europe/Kyiv';

import '@testing-library/jest-dom/vitest';
import { beforeAll } from 'vitest';

// happy-dom (and jsdom <22) do not implement the PointerEvent capture APIs that
// Radix UI primitives (Select, Dialog, ...) rely on. Polyfill the minimal surface
// so userEvent click handlers work in component tests. Without these, opening a
// `<Select>` throws "target.hasPointerCapture is not a function" and the listbox
// never appears in the DOM.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.hasPointerCapture !== 'function') {
    proto.hasPointerCapture = function hasPointerCapture() {
      return false;
    };
  }
  if (typeof proto.setPointerCapture !== 'function') {
    proto.setPointerCapture = function setPointerCapture() {
      /* noop */
    };
  }
  if (typeof proto.releasePointerCapture !== 'function') {
    proto.releasePointerCapture = function releasePointerCapture() {
      /* noop */
    };
  }
  if (typeof proto.scrollIntoView !== 'function') {
    proto.scrollIntoView = function scrollIntoView() {
      /* noop */
    };
  }
});
