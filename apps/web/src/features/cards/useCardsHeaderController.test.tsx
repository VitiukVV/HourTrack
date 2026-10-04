import { act, renderHook } from '@testing-library/react';
import type { DragEndEvent } from '@dnd-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Card } from '@hourtrack/shared-types';

import { useCardsHeaderController } from './useCardsHeaderController';

/** Spec 008 — drop → reorder decisions, tested without rendering the row. */

const cards = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
] as Card[];
const reorderMutate = vi.fn();
const archiveMutateAsync = vi.fn();
vi.mock('./useCards', () => ({
  useCardsQuery: () => ({ data: cards, isSuccess: true }),
  useArchiveCardMutation: () => ({ mutateAsync: archiveMutateAsync }),
  useReorderCardsMutation: () => ({ mutate: reorderMutate }),
}));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (msg: string) => toastError(msg) } }));

const drop = (active: string, over: string | null) =>
  ({ active: { id: active }, over: over === null ? null : { id: over } }) as DragEndEvent;

afterEach(() => {
  vi.clearAllMocks();
});

describe('useCardsHeaderController — drag end', () => {
  it('reorders to the slot the card was dropped on', () => {
    const { result } = renderHook(() => useCardsHeaderController());
    act(() => result.current.handleDragEnd(drop('a', 'b')));
    expect(reorderMutate).toHaveBeenCalledWith({ cardId: 'a', toIndex: 1 });
  });

  it('writes nothing for a drop on its own slot or outside the row', () => {
    const { result } = renderHook(() => useCardsHeaderController());
    act(() => result.current.handleDragEnd(drop('a', 'a')));
    act(() => result.current.handleDragEnd(drop('a', null)));
    expect(reorderMutate).not.toHaveBeenCalled();
  });

  it('says so instead of moving when the row changed under the drag', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useCardsHeaderController());
    act(() => result.current.handleDragEnd(drop('gone', 'b')));
    expect(reorderMutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});

describe('useCardsHeaderController — archive', () => {
  it('archives the card the user confirmed, and toasts when it fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    archiveMutateAsync.mockRejectedValueOnce(new Error('disk full'));
    const { result } = renderHook(() => useCardsHeaderController());

    act(() => result.current.handleArchive(cards[0]!)());
    act(() => vi.runAllTimers());
    vi.useRealTimers();
    expect(result.current.pendingArchive?.id).toBe('a');

    await act(async () => {
      result.current.handleConfirmArchive();
    });

    expect(archiveMutateAsync).toHaveBeenCalledWith('a');
    expect(result.current.pendingArchive).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('does nothing when confirm fires with no card pending', () => {
    const { result } = renderHook(() => useCardsHeaderController());
    act(() => result.current.handleConfirmArchive());
    expect(archiveMutateAsync).not.toHaveBeenCalled();
  });
});
