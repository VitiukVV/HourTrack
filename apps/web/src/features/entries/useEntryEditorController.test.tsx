import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { useEntryEditorController } from './useEntryEditorController';

const updateMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();
vi.mock('./useEntries', () => ({
  useUpdateEntryMutation: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  useDeleteEntryMutation: () => ({ mutateAsync: deleteMutateAsync }),
}));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (msg: string) => toastError(msg) } }));

/** The slice of Node's `process` this file needs (the app tsconfig has no node types). */
interface NodeProcessEvents {
  listeners(event: 'unhandledRejection'): Array<(...args: unknown[]) => void>;
  removeAllListeners(event: 'unhandledRejection'): void;
  on(event: 'unhandledRejection', listener: (...args: unknown[]) => void): void;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** Spec 008 — the editor's derivations, tested without rendering the form. */

const entry: Entry = {
  id: 'e1',
  cardId: 'c1',
  date: '2026-05-14',
  startMinutes: 540,
  durationMin: 60,
  useCustomPayment: false,
  customPayment: null,
  note: null,
  googleEventId: null,
  syncStatus: 'pending',
  syncError: null,
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
};

const card: Card = {
  id: 'c1',
  name: 'Card',
  color: '#2563EB',
  position: 0,
  defaultDurationMin: 60,
  defaultStartMinutes: 540,
  rateType: 'hourly',
  hourlyRate: 10,
  fixedTotal: null,
  monthlyTotal: null,
  defaultNote: null,
  isArchived: false,
  archivedAt: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('useEntryEditorController', () => {
  it('derives the end time and inverts a picked end into the duration', () => {
    const onDirtyChange = vi.fn();
    const { result } = renderHook(
      () => useEntryEditorController({ entry, card, allCardEntries: [entry], onDirtyChange }),
      { wrapper },
    );
    expect(result.current.derivedEndMinutes).toBe(600);
    expect(result.current.previewEarnings).toBeCloseTo(10);

    act(() => result.current.handleEndChange(690));

    expect(result.current.derivedEndMinutes).toBe(690);
    expect(result.current.previewEarnings).toBeCloseTo(25);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  const saved = {
    date: '2026-05-14',
    startMinutes: 540,
    durationMin: 150,
    useCustomPayment: false,
    customPayment: null,
    note: null,
  };

  it('after a successful save the form is clean again, at the saved values, then onSaved fires', async () => {
    updateMutateAsync.mockResolvedValueOnce(undefined);
    const onSaved = vi.fn();
    const onDirtyChange = vi.fn();
    const { result } = renderHook(
      () =>
        useEntryEditorController({ entry, card, allCardEntries: [entry], onSaved, onDirtyChange }),
      { wrapper },
    );
    act(() => result.current.handleEndChange(690));
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      result.current.onValid(saved);
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(result.current.isDirty).toBe(false);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(result.current.derivedEndMinutes).toBe(690);
  });

  it('a throw from onSaved after a successful save is not reported as a save failure', async () => {
    // Spec 009: it reaches the global unhandled-rejection net instead. Swap
    // the process listeners so the test runner does not count it as its own.
    const process = (globalThis as unknown as { process: NodeProcessEvents }).process;
    const runnerListeners = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      updateMutateAsync.mockResolvedValueOnce(undefined);
      const onSaved = vi.fn(() => {
        throw new Error('parent broke');
      });
      const { result } = renderHook(
        () => useEntryEditorController({ entry, card, allCardEntries: [entry], onSaved }),
        { wrapper },
      );
      act(() => result.current.handleEndChange(690));

      await act(async () => {
        result.current.onValid(saved);
      });

      await waitFor(() => expect(unhandled).toHaveBeenCalledTimes(1));
      expect(toastError).not.toHaveBeenCalled();
      expect(result.current.isDirty).toBe(false);
    } finally {
      process.removeAllListeners('unhandledRejection');
      for (const l of runnerListeners) process.on('unhandledRejection', l);
    }
  });

  it('a failed save toasts, keeps the edit and does not report it saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    updateMutateAsync.mockRejectedValueOnce(new Error('disk full'));
    const onSaved = vi.fn();
    const { result } = renderHook(
      () => useEntryEditorController({ entry, card, allCardEntries: [entry], onSaved }),
      { wrapper },
    );
    act(() => result.current.handleEndChange(690));

    await act(async () => {
      result.current.onValid(saved);
    });

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.isDirty).toBe(true);
  });

  it('a failed delete closes the confirm and does not report it deleted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    deleteMutateAsync.mockRejectedValueOnce(new Error('disk full'));
    const onDeleted = vi.fn();
    const { result } = renderHook(
      () => useEntryEditorController({ entry, card, allCardEntries: [entry], onDeleted }),
      { wrapper },
    );
    act(() => result.current.setConfirmOpen(true));

    await act(async () => {
      result.current.handleConfirmDelete();
    });

    // The toast is the hook's (spec 009, useEntries.writeFailure.test).
    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(result.current.confirmOpen).toBe(false);
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
