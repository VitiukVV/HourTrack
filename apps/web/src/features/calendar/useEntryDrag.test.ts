import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';

import type { Entry } from '@hourtrack/shared-types';

// Mock the mutation hook so we can assert calls + control resolve/reject
// without a real DB. This is the spec's "test onDragEnd directly with fake
// {active, over} payloads" approach (Task 20) — the reliable jsdom coverage.
const mutateAsync = vi.fn<(args: { id: string; patch: { date: string } }) => Promise<Entry>>();
vi.mock('@/features/entries/useEntries', () => ({
  useUpdateEntryMutation: () => ({ mutateAsync }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { useEntryDrag } from './useEntryDrag';

const ENTRY: Entry = {
  id: 'e1',
  cardId: 'c1',
  date: '2026-05-14',
  startMinutes: 600,
  durationMin: 120,
  useCustomPayment: false,
  customPayment: null,
  note: null,
  googleEventId: null,
  syncStatus: 'pending',
  syncError: null,
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
};

function dragEnd(overId: string | null): DragEndEvent {
  return {
    active: { id: ENTRY.id, data: { current: { entry: ENTRY, card: undefined } } },
    over: overId == null ? null : { id: overId, data: { current: {} }, rect: {} as never },
  } as unknown as DragEndEvent;
}

describe('useEntryDrag — onDragEnd', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('different day → mutates with { id, patch: { date } } and fires success toast', async () => {
    mutateAsync.mockResolvedValue({ ...ENTRY, date: '2026-05-21' });
    const { result } = renderHook(() => useEntryDrag());

    result.current.onDragEnd(dragEnd('2026-05-21'));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({ id: 'e1', patch: { date: '2026-05-21' } });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('same day → no mutation, no toast', () => {
    const { result } = renderHook(() => useEntryDrag());
    result.current.onDragEnd(dragEnd('2026-05-14'));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('no over target (dropped outside any droppable) → no mutation', () => {
    const { result } = renderHook(() => useEntryDrag());
    result.current.onDragEnd(dragEnd(null));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('mutation rejects → error toast fired, no success', async () => {
    mutateAsync.mockRejectedValue(new Error('boom'));
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useEntryDrag());

    result.current.onDragEnd(dragEnd('2026-05-21'));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('success toast carries a working Undo action that re-mutates date back', async () => {
    mutateAsync.mockResolvedValue({ ...ENTRY, date: '2026-05-21' });
    const { result } = renderHook(() => useEntryDrag());

    result.current.onDragEnd(dragEnd('2026-05-21'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));

    // Pull the action handler off the toast options and invoke it.
    const opts = toastSuccess.mock.calls[0]![1] as { action: { onClick: () => void } };
    mutateAsync.mockResolvedValue({ ...ENTRY, date: '2026-05-14' });
    opts.action.onClick();

    expect(mutateAsync).toHaveBeenLastCalledWith({ id: 'e1', patch: { date: '2026-05-14' } });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(2));
  });

  it('uses MouseSensor + TouchSensor, NOT PointerSensor (touch press-hold owns the drag)', () => {
    // Regression guard for the mobile-drag bug: PointerSensor captures touch
    // too and, with no delay, races TouchSensor for the finger — the browser
    // cancels it on scroll so one-finger drag never starts. Mouse and touch
    // must stay on dedicated sensors.
    const { result } = renderHook(() => useEntryDrag());
    const names = result.current.sensors.map((s) => s.sensor.name);
    expect(names).toContain('MouseSensor');
    expect(names).toContain('TouchSensor');
    expect(names).not.toContain('PointerSensor');
  });

  it('onDragStart stashes the active entry; onDragCancel clears it', () => {
    const { result } = renderHook(() => useEntryDrag());

    act(() => {
      result.current.onDragStart({
        active: { id: ENTRY.id, data: { current: { entry: ENTRY, card: undefined } } },
      } as unknown as DragStartEvent);
    });
    expect(result.current.activeEntry?.id).toBe('e1');

    act(() => {
      result.current.onDragCancel();
    });
    expect(result.current.activeEntry).toBeNull();
  });
});
