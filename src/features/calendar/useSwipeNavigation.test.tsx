import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSwipeNavigation, type UseSwipeNavigationOptions } from './useSwipeNavigation';

function Probe({
  onChildClick,
  ...options
}: UseSwipeNavigationOptions & { onChildClick?: () => void }) {
  const swipe = useSwipeNavigation(options);
  return (
    <div
      data-testid="area"
      data-offset={swipe.offset}
      data-swiping={swipe.isSwiping ? 'true' : 'false'}
      {...swipe.handlers}
    >
      <button type="button" onClick={onChildClick}>
        day cell
      </button>
    </div>
  );
}

interface GestureOptions {
  from: number;
  to: number;
  fromY?: number;
  toY?: number;
  pointerType?: string;
  /** Skip the pointerup — leaves the gesture mid-flight. */
  hold?: boolean;
  /** Fires pointercancel instead of pointerup. */
  cancel?: boolean;
  /** Callback run after pointerdown (e.g. to advance the clock). */
  afterDown?: () => void;
}

function swipe(el: HTMLElement, opts: GestureOptions) {
  const { from, to, fromY = 200, toY = fromY, pointerType = 'touch' } = opts;
  const base = { pointerId: 1, pointerType, isPrimary: true };
  fireEvent.pointerDown(el, { ...base, clientX: from, clientY: fromY });
  opts.afterDown?.();
  fireEvent.pointerMove(el, {
    ...base,
    clientX: (from + to) / 2,
    clientY: (fromY + toY) / 2,
  });
  fireEvent.pointerMove(el, { ...base, clientX: to, clientY: toY });
  if (opts.hold) return;
  if (opts.cancel) fireEvent.pointerCancel(el, { ...base, clientX: to, clientY: toY });
  else fireEvent.pointerUp(el, { ...base, clientX: to, clientY: toY });
}

function handlers() {
  return { onSwipeLeft: vi.fn(), onSwipeRight: vi.fn() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSwipeNavigation', () => {
  it('a left flick calls onSwipeLeft (forward in time)', () => {
    const h = handlers();
    render(<Probe {...h} />);
    swipe(screen.getByTestId('area'), { from: 300, to: 200 });
    expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(h.onSwipeRight).not.toHaveBeenCalled();
  });

  it('a right flick calls onSwipeRight (back in time)', () => {
    const h = handlers();
    render(<Probe {...h} />);
    swipe(screen.getByTestId('area'), { from: 100, to: 220 });
    expect(h.onSwipeRight).toHaveBeenCalledTimes(1);
    expect(h.onSwipeLeft).not.toHaveBeenCalled();
  });

  it('reports the committed direction through onCommit', () => {
    const h = handlers();
    const onCommit = vi.fn();
    render(<Probe {...h} onCommit={onCommit} />);
    swipe(screen.getByTestId('area'), { from: 300, to: 200 });
    expect(onCommit).toHaveBeenCalledWith('next');
  });

  it('ignores a horizontal move shorter than the flick minimum', () => {
    const h = handlers();
    render(<Probe {...h} />);
    swipe(screen.getByTestId('area'), { from: 300, to: 282 });
    expect(h.onSwipeLeft).not.toHaveBeenCalled();
    expect(h.onSwipeRight).not.toHaveBeenCalled();
  });

  it('commits a slow drag once it passes the distance threshold', () => {
    // Clock advanced far enough that the velocity path can't be what commits.
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(0); // pointerdown
    now.mockReturnValue(190); // moves stay under the hold guard
    const h = handlers();
    render(<Probe {...h} />);
    swipe(screen.getByTestId('area'), { from: 300, to: 220 });
    expect(h.onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  it('ignores a predominantly vertical gesture', () => {
    const h = handlers();
    render(<Probe {...h} />);
    swipe(screen.getByTestId('area'), { from: 300, to: 220, fromY: 100, toY: 400 });
    expect(h.onSwipeLeft).not.toHaveBeenCalled();
    expect(h.onSwipeRight).not.toHaveBeenCalled();
  });

  it('ignores the mouse — dnd-kit owns that pointer type', () => {
    const h = handlers();
    render(<Probe {...h} />);
    swipe(screen.getByTestId('area'), { from: 300, to: 180, pointerType: 'mouse' });
    expect(h.onSwipeLeft).not.toHaveBeenCalled();
  });

  it('abandons the gesture when the finger lingered first (chip drag)', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(0); // pointerdown
    now.mockReturnValue(400); // first move arrives past the hold guard
    const h = handlers();
    render(<Probe {...h} />);
    swipe(screen.getByTestId('area'), { from: 300, to: 180 });
    expect(h.onSwipeLeft).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', () => {
    const h = handlers();
    render(<Probe {...h} disabled />);
    swipe(screen.getByTestId('area'), { from: 300, to: 180 });
    expect(h.onSwipeLeft).not.toHaveBeenCalled();
  });

  it('pointercancel ends the gesture without navigating', () => {
    const h = handlers();
    render(<Probe {...h} />);
    swipe(screen.getByTestId('area'), { from: 300, to: 180, cancel: true });
    expect(h.onSwipeLeft).not.toHaveBeenCalled();
    expect(screen.getByTestId('area')).toHaveAttribute('data-swiping', 'false');
  });

  it('tracks the finger with a damped, clamped offset while swiping', () => {
    const h = handlers();
    render(<Probe {...h} />);
    const area = screen.getByTestId('area');
    swipe(area, { from: 300, to: 240, hold: true });
    expect(area).toHaveAttribute('data-swiping', 'true');
    const offset = Number(area.getAttribute('data-offset'));
    expect(offset).toBeLessThan(0);
    expect(Math.abs(offset)).toBeLessThan(60); // damped below the raw 60px

    fireEvent.pointerUp(area, { pointerId: 1, pointerType: 'touch', clientX: 240, clientY: 200 });
    expect(area).toHaveAttribute('data-offset', '0');
  });

  it('reports no offset when animation is off (reduced motion)', () => {
    const h = handlers();
    render(<Probe {...h} animate={false} />);
    const area = screen.getByTestId('area');
    swipe(area, { from: 300, to: 240, hold: true });
    expect(area).toHaveAttribute('data-offset', '0');
    expect(area).toHaveAttribute('data-swiping', 'true');
  });

  it('swallows the click that follows a swipe so day cells stay inert', () => {
    const h = handlers();
    const onChildClick = vi.fn();
    render(<Probe {...h} onChildClick={onChildClick} />);
    const area = screen.getByTestId('area');
    swipe(area, { from: 300, to: 200 });
    fireEvent.click(screen.getByRole('button', { name: 'day cell' }));
    expect(onChildClick).not.toHaveBeenCalled();

    // Only ONE click is swallowed — the next tap works normally.
    fireEvent.click(screen.getByRole('button', { name: 'day cell' }));
    expect(onChildClick).toHaveBeenCalledTimes(1);
  });

  it('leaves a plain tap alone', () => {
    const h = handlers();
    const onChildClick = vi.fn();
    render(<Probe {...h} onChildClick={onChildClick} />);
    const area = screen.getByTestId('area');
    fireEvent.pointerDown(area, {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerUp(area, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 302,
      clientY: 201,
    });
    fireEvent.click(screen.getByRole('button', { name: 'day cell' }));
    expect(onChildClick).toHaveBeenCalledTimes(1);
    expect(h.onSwipeLeft).not.toHaveBeenCalled();
  });
});
