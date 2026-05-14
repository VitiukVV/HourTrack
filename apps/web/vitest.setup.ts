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
