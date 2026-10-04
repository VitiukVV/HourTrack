import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { useEntryEditorController } from './useEntryEditorController';

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
});
