import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Card } from '@hourtrack/shared-types';

import { useDayPageController } from './useDayPageController';

/**
 * Spec 008 — "+ Add entry" → picked card → new entry. The page test pins only
 * the start time; this pins the rest of the payload. A failed create is
 * toasted by the hook (spec 009).
 */

const createMutate = vi.fn();
vi.mock('@/features/entries/useEntries', () => ({
  useCreateEntryMutation: () => ({ mutate: createMutate }),
  useEntriesByDateQuery: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock('@/features/entries/useEntriesInRange', () => ({
  useEntriesInRange: () => ({ data: undefined }),
}));
vi.mock('@/features/cards/useCards', () => ({ useAllCardsQuery: () => ({ data: [] }) }));

const card = {
  id: 'c1',
  defaultStartMinutes: 600,
  defaultDurationMin: 90,
  defaultNote: 'standup',
} as Card;

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('useDayPageController — add entry', () => {
  it('creates the entry from the picked card defaults on the page day', () => {
    const { result } = renderHook(() => useDayPageController('2026-05-14'));

    act(() => result.current.handlePick(card));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        cardId: 'c1',
        date: '2026-05-14',
        startMinutes: 600,
        durationMin: 90,
        note: 'standup',
        useCustomPayment: false,
        customPayment: null,
        syncStatus: 'pending',
      }),
    );
    // No per-call options: a failure is the hook's to report (spec 009).
    expect(createMutate.mock.calls[0]).toHaveLength(1);
  });
});
