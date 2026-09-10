import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCardRowSensors } from './useCardRowSensors';

/**
 * 001-cards-order-colors (FR-004, FR-015) — the pill row's input recipe.
 *
 * Nothing else in the suite can see these choices: the sensors are handed to
 * a `DndContext` and the browser does the rest, so swapping in PointerSensor
 * or restoring dnd-kit's default key bindings kept every other test green
 * while breaking touch scrolling and keyboard card activation respectively.
 * Mirrors `features/calendar/useEntryDrag.test.ts`'s guard, which exists for
 * the same reason on the same recipe.
 */

describe('useCardRowSensors', () => {
  it('uses MouseSensor + TouchSensor, NOT PointerSensor', () => {
    // PointerSensor captures touch too and races TouchSensor for the finger:
    // the browser cancels it on scroll, so a one-finger drag never starts.
    const { result } = renderHook(() => useCardRowSensors());
    const names = result.current.map((s) => s.sensor.name);
    expect(names).toContain('MouseSensor');
    expect(names).toContain('TouchSensor');
    expect(names).toContain('KeyboardSensor');
    expect(names).not.toContain('PointerSensor');
  });

  it('keeps the mouse threshold at 8px so a click stays a click', () => {
    const { result } = renderHook(() => useCardRowSensors());
    const mouse = result.current.find((s) => s.sensor.name === 'MouseSensor');
    expect(mouse?.options).toEqual({ activationConstraint: { distance: 8 } });
  });

  it('holds touch for 220ms so a swipe still scrolls the row', () => {
    // Drop the delay and the row stops being swipeable — the first finger
    // movement lifts a pill instead of scrolling.
    const { result } = renderHook(() => useCardRowSensors());
    const touch = result.current.find((s) => s.sensor.name === 'TouchSensor');
    expect(touch?.options).toEqual({ activationConstraint: { delay: 220, tolerance: 8 } });
  });

  it('binds Space to the drag and leaves Enter for card activation', () => {
    // dnd-kit's default `start` is [Space, Enter] and its activator calls
    // preventDefault(), which on a <button> also cancels the synthetic click.
    // With the defaults a chip's `aria-pressed` could not be toggled by
    // keyboard at all (WCAG 2.1.1).
    const { result } = renderHook(() => useCardRowSensors());
    const keyboard = result.current.find((s) => s.sensor.name === 'KeyboardSensor');
    const options = keyboard?.options as { keyboardCodes?: Record<string, string[]> };
    expect(options.keyboardCodes?.start).toEqual(['Space']);
    expect(options.keyboardCodes?.start).not.toContain('Enter');
    expect(options.keyboardCodes?.cancel).toEqual(['Escape']);
    expect(options.keyboardCodes?.end).toContain('Enter');
  });
});
