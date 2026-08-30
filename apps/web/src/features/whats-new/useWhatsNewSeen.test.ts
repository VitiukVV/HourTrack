import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LATEST_CHANGELOG_VERSION } from './changelog';
import { useWhatsNewSeen, WHATS_NEW_SEEN_STORAGE_KEY } from './useWhatsNewSeen';

beforeEach(() => {
  localStorage.clear();
});

describe('useWhatsNewSeen', () => {
  it('reports unseen when no version has ever been stored', () => {
    const { result } = renderHook(() => useWhatsNewSeen());
    expect(result.current.hasUnseen).toBe(true);
  });

  it('reports seen already when localStorage holds the latest version', () => {
    localStorage.setItem(WHATS_NEW_SEEN_STORAGE_KEY, LATEST_CHANGELOG_VERSION ?? '');
    const { result } = renderHook(() => useWhatsNewSeen());
    expect(result.current.hasUnseen).toBe(false);
  });

  it('reports unseen when a stale version is stored', () => {
    localStorage.setItem(WHATS_NEW_SEEN_STORAGE_KEY, '0.0.1');
    const { result } = renderHook(() => useWhatsNewSeen());
    expect(result.current.hasUnseen).toBe(true);
  });

  it('markSeen() clears hasUnseen and persists the latest version', () => {
    const { result } = renderHook(() => useWhatsNewSeen());
    expect(result.current.hasUnseen).toBe(true);

    act(() => {
      result.current.markSeen();
    });

    expect(result.current.hasUnseen).toBe(false);
    expect(localStorage.getItem(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(LATEST_CHANGELOG_VERSION);
  });
});

/**
 * Site data blocked / Safari private mode: both accessors throw. The badge is
 * a nicety, so it degrades to "always new" rather than taking the render down
 * with it.
 */
describe('useWhatsNewSeen — storage unavailable', () => {
  it('does not throw when localStorage getItem/setItem reject', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      const { result } = renderHook(() => useWhatsNewSeen());
      expect(result.current.hasUnseen).toBe(true);
      act(() => {
        result.current.markSeen();
      });
      expect(result.current.hasUnseen).toBe(false);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
