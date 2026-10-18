import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useActiveCardStore, ACTIVE_CARD_STORAGE_KEY } from './useActiveCardStore';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  useActiveCardStore.getState().clearActive();
});

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('useActiveCardStore', () => {
  it('starts with activeCardId === null', () => {
    expect(useActiveCardStore.getState().activeCardId).toBeNull();
  });

  it('setActiveCardId updates state', () => {
    useActiveCardStore.getState().setActiveCardId('abc-123');
    expect(useActiveCardStore.getState().activeCardId).toBe('abc-123');
  });

  it('clearActive resets to null', () => {
    useActiveCardStore.getState().setActiveCardId('abc-123');
    useActiveCardStore.getState().clearActive();
    expect(useActiveCardStore.getState().activeCardId).toBeNull();
  });

  it('persists activeCardId to sessionStorage (NOT localStorage)', () => {
    useActiveCardStore.getState().setActiveCardId('persisted-id');

    // Persistence writes happen synchronously on state change with zustand persist
    const raw = sessionStorage.getItem(ACTIVE_CARD_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(raw).toContain('persisted-id');

    // CRITICAL: must NOT touch localStorage
    expect(localStorage.getItem(ACTIVE_CARD_STORAGE_KEY)).toBeNull();
  });

  it('clearActive clears the sessionStorage entry too', () => {
    useActiveCardStore.getState().setActiveCardId('temp');
    useActiveCardStore.getState().clearActive();

    const raw = sessionStorage.getItem(ACTIVE_CARD_STORAGE_KEY);
    if (raw) {
      // Persisted-null is acceptable; the parsed shape must show no active card.
      expect(raw).not.toContain('temp');
    }
    expect(useActiveCardStore.getState().activeCardId).toBeNull();
  });
});
