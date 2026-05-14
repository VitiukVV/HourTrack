import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLongPress } from './useLongPress';

/**
 * S03 followup tests: a touch-only long-press hook. Triggers `onLongPress`
 * after 500ms of a touch pointerdown that hasn't been released or cancelled.
 * Mouse pointers must NOT trigger — the right-click context menu (already
 * wired by S03) covers desktop.
 */

interface ProbeProps {
  onLongPress: () => void;
  delayMs?: number;
}

function Probe({ onLongPress, delayMs }: ProbeProps) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const handlers = useLongPress(onLongPress, { delayMs: delayMs ?? 500 });
  return (
    <button type="button" ref={ref} {...handlers}>
      target
    </button>
  );
}

function dispatchPointer(
  el: HTMLElement,
  type: 'pointerDown' | 'pointerUp' | 'pointerLeave' | 'pointerCancel' | 'pointerMove',
  pointerType: 'touch' | 'mouse' | 'pen',
) {
  // testing-library's fireEvent dispatches the event through React's
  // synthetic event system, which is what `useLongPress` listens to. For
  // pointer events we pass `pointerType` in the init dict; React forwards
  // it onto the SyntheticPointerEvent so our handler sees it.
  fireEvent[type](el, { pointerType, clientX: 0, clientY: 0 });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLongPress', () => {
  it('fires onLongPress after the delay when pointerType is "touch"', () => {
    const onLongPress = vi.fn();
    render(<Probe onLongPress={onLongPress} />);
    const button = screen.getByRole('button', { name: /target/ });

    act(() => {
      dispatchPointer(button, 'pointerDown', 'touch');
    });
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when pointerType is "mouse"', () => {
    const onLongPress = vi.fn();
    render(<Probe onLongPress={onLongPress} />);
    const button = screen.getByRole('button', { name: /target/ });

    act(() => {
      dispatchPointer(button, 'pointerDown', 'mouse');
      vi.advanceTimersByTime(1000);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels the timer on pointerup before the threshold', () => {
    const onLongPress = vi.fn();
    render(<Probe onLongPress={onLongPress} />);
    const button = screen.getByRole('button', { name: /target/ });

    act(() => {
      dispatchPointer(button, 'pointerDown', 'touch');
      vi.advanceTimersByTime(200);
      dispatchPointer(button, 'pointerUp', 'touch');
      vi.advanceTimersByTime(1000);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels the timer on pointerleave / pointercancel', () => {
    const onLongPress = vi.fn();
    render(<Probe onLongPress={onLongPress} />);
    const button = screen.getByRole('button', { name: /target/ });

    act(() => {
      dispatchPointer(button, 'pointerDown', 'touch');
      vi.advanceTimersByTime(200);
      dispatchPointer(button, 'pointerLeave', 'touch');
      vi.advanceTimersByTime(1000);
    });
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      dispatchPointer(button, 'pointerDown', 'touch');
      vi.advanceTimersByTime(200);
      dispatchPointer(button, 'pointerCancel', 'touch');
      vi.advanceTimersByTime(1000);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('respects a custom delayMs option', () => {
    const onLongPress = vi.fn();
    render(<Probe onLongPress={onLongPress} delayMs={250} />);
    const button = screen.getByRole('button', { name: /target/ });

    act(() => {
      dispatchPointer(button, 'pointerDown', 'touch');
      vi.advanceTimersByTime(249);
    });
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});
