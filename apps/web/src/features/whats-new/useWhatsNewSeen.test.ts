import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

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
