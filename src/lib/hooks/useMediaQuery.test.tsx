import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MEDIA_QUERIES, useMediaQuery } from './useMediaQuery';

/**
 * S18 — `useMediaQuery` hook tests.
 *
 * The matchMedia polyfill in `vitest.setup.ts` provides a default mock that
 * returns `matches: false` for any query. Tests that need a truthy match
 * override `window.matchMedia` per-test before rendering.
 *
 * Without the setup polyfill, the very FIRST `renderHook(...)` call below
 * would throw `TypeError: window.matchMedia is not a function` at the
 * hook's initialiser — the spec's matchMedia-polyfill non-negotiable is
 * locked in by these tests.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function makeMediaQueryList(matches: boolean, query: string) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn((_: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    }),
    removeEventListener: vi.fn((_: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    // Test-only escape hatch — fire a synthetic change event.
    __fire(next: boolean) {
      this.matches = next;
      listeners.forEach((cb) =>
        cb({ matches: next, media: query } as unknown as MediaQueryListEvent),
      );
    },
  };
}

describe('useMediaQuery', () => {
  it('returns false when the media query does not match', () => {
    // Default setup mock returns matches: false — no per-test override needed.
    const { result } = renderHook(() => useMediaQuery(MEDIA_QUERIES.belowMd));
    expect(result.current).toBe(false);
  });

  it('returns true when the media query matches', () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => makeMediaQueryList(true, q));
    const { result } = renderHook(() => useMediaQuery(MEDIA_QUERIES.belowMd));
    expect(result.current).toBe(true);
  });

  it('updates when the underlying match changes', () => {
    let mql: ReturnType<typeof makeMediaQueryList> | null = null;
    window.matchMedia = vi.fn().mockImplementation((q: string) => {
      mql = makeMediaQueryList(false, q);
      return mql;
    });

    const { result } = renderHook(() => useMediaQuery(MEDIA_QUERIES.belowMd));
    expect(result.current).toBe(false);

    expect(mql).not.toBeNull();
    act(() => {
      mql!.__fire(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      mql!.__fire(false);
    });
    expect(result.current).toBe(false);
  });

  it('unsubscribes the change listener on unmount', () => {
    let mql: ReturnType<typeof makeMediaQueryList> | null = null;
    window.matchMedia = vi.fn().mockImplementation((q: string) => {
      mql = makeMediaQueryList(false, q);
      return mql;
    });

    const { unmount } = renderHook(() => useMediaQuery(MEDIA_QUERIES.belowMd));
    expect(mql!.addEventListener).toHaveBeenCalledTimes(1);

    unmount();
    expect(mql!.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('uses the legacy addListener fallback when addEventListener is missing', () => {
    let mql: {
      matches: boolean;
      media: string;
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    } | null = null;
    window.matchMedia = vi.fn().mockImplementation((q: string) => {
      mql = {
        matches: true,
        media: q,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      };
      // Intentionally NO addEventListener — exercise the legacy branch.
      return mql;
    });

    const { result, unmount } = renderHook(() => useMediaQuery(MEDIA_QUERIES.belowMd));
    expect(result.current).toBe(true);
    expect(mql!.addListener).toHaveBeenCalledTimes(1);
    unmount();
    expect(mql!.removeListener).toHaveBeenCalledTimes(1);
  });
});
