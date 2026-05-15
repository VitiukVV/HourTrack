// S16 -- pin the test runner's timezone BEFORE any imports run. Some date
// libs (and `Intl.DateTimeFormat().resolvedOptions().timeZone`) latch the
// host TZ at module init time, so a setting placed below the imports would
// be too late. Without this pin, S16b's `buildEvent` tests assert on
// `start.timeZone === 'Europe/Kyiv'` and would flake against any CI runner
// or contributor machine whose host TZ differs from Kyiv (CI is UTC, devs
// vary). Pinning here makes every Calendar-payload test deterministic.
process.env.TZ = 'Europe/Kyiv';

import '@testing-library/jest-dom/vitest';
import { beforeAll, vi } from 'vitest';

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

// S18 — `window.matchMedia` polyfill. happy-dom does NOT implement this API,
// so every test that imports `useMediaQuery` (or any code that calls
// `window.matchMedia(...)` at module-init / render time) throws
// `TypeError: window.matchMedia is not a function`.
//
// Default behaviour: `matches: false` for any query — i.e. the test renders
// the "doesn't match" branch (desktop / wide viewport).
//
// Tests that need the "matches" branch override per-test:
//   window.matchMedia = vi.fn().mockReturnValue({
//     matches: true,
//     media: '(max-width: 767px)',
//     onchange: null,
//     addEventListener: vi.fn(),
//     removeEventListener: vi.fn(),
//     dispatchEvent: vi.fn(),
//   });
//
// IMPORTANT: this polyfill must load BEFORE any test file imports a module
// that calls matchMedia at module init or render. Lives in `vitest.setup.ts`
// (referenced from `vitest.config.ts -> setupFiles`) which vitest executes
// before any test file is parsed.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // legacy API kept for older callers
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
