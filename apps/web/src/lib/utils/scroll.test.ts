import { describe, expect, it, vi } from 'vitest';

import { scrollPageToTop } from './scroll';

/**
 * `window.scrollTo` alone is a no-op in this app — `<body>` is the live
 * scroll container (see the util's docblock), so the reset has to reach it.
 */
describe('scrollPageToTop', () => {
  it('resets the body scroll offset, not just the window', () => {
    const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    document.body.scrollTop = 240;
    document.documentElement.scrollTop = 240;

    scrollPageToTop();

    expect(document.body.scrollTop).toBe(0);
    expect(document.documentElement.scrollTop).toBe(0);
    expect(spy).toHaveBeenCalledWith(0, 0);
    spy.mockRestore();
  });
});
