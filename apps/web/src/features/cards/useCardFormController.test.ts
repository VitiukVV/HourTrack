import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCardFormController } from './useCardFormController';

/** Spec 008 — the card form's derivations, tested without rendering it. */

describe('useCardFormController', () => {
  it('starts a new card at 09:00 with no duration, and back-solves a picked end time', () => {
    const { result } = renderHook(() =>
      useCardFormController({ mode: 'create', onSave: () => {} }),
    );
    expect(result.current.derivedEndMinutes).toBe(540);
    expect(result.current.rateType).toBe('hourly');

    act(() => result.current.handleEndChange(540 + 150));

    expect(result.current.derivedEndMinutes).toBe(690);
  });

  it('seeds an edited card from its saved values', () => {
    const { result } = renderHook(() =>
      useCardFormController({
        mode: 'edit',
        defaultValues: {
          name: 'Retainer',
          color: '#2563EB',
          defaultDurationMin: 90,
          defaultStartMinutes: 600,
          rateType: 'monthly',
          hourlyRate: null,
          fixedTotal: null,
          monthlyTotal: 1000,
          defaultNote: null,
        },
        onSave: () => {},
      }),
    );

    expect(result.current.rateType).toBe('monthly');
    expect(result.current.derivedEndMinutes).toBe(690);
  });
});
