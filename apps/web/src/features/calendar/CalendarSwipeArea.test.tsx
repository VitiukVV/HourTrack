import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CalendarSwipeArea } from './CalendarSwipeArea';
import { CALENDAR_VIEW_STORAGE_KEY, useCalendarView } from './calendarStore';

/** Mon 2026-05-11 .. Sun 2026-05-17 — a full week inside May 2026. */
const ANCHOR = '2026-05-13';

function flick(el: HTMLElement, from: number, to: number) {
  const base = { pointerId: 1, pointerType: 'touch', isPrimary: true, clientY: 300 };
  fireEvent.pointerDown(el, { ...base, clientX: from });
  fireEvent.pointerMove(el, { ...base, clientX: (from + to) / 2 });
  fireEvent.pointerMove(el, { ...base, clientX: to });
  fireEvent.pointerUp(el, { ...base, clientX: to });
}

function area() {
  return screen.getByTestId('calendar-swipe-area');
}

/**
 * happy-dom does not implement the Web Animations API, so `element.animate`
 * has to be installed (not spied on) before a test can assert against it.
 * Returns the uninstaller.
 */
function installAnimateStub(): { animate: ReturnType<typeof vi.fn>; restore: () => void } {
  const animate = vi.fn();
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const had = 'animate' in proto;
  const original = proto.animate;
  proto.animate = animate;
  return {
    animate,
    restore: () => {
      if (had) proto.animate = original;
      else delete proto.animate;
    },
  };
}

beforeEach(() => {
  useCalendarView.setState({ mode: 'month', anchorDate: ANCHOR });
  sessionStorage.removeItem(CALENDAR_VIEW_STORAGE_KEY);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CalendarSwipeArea', () => {
  it('renders its children', () => {
    render(
      <CalendarSwipeArea>
        <div data-testid="body">calendar</div>
      </CalendarSwipeArea>,
    );
    expect(screen.getByTestId('body')).toBeInTheDocument();
  });

  it('a left flick advances the month in month mode', () => {
    render(
      <CalendarSwipeArea>
        <div />
      </CalendarSwipeArea>,
    );
    flick(area(), 300, 180);
    expect(useCalendarView.getState().anchorDate).toBe('2026-06-13');
  });

  it('a right flick steps back a month in month mode', () => {
    render(
      <CalendarSwipeArea>
        <div />
      </CalendarSwipeArea>,
    );
    flick(area(), 100, 240);
    expect(useCalendarView.getState().anchorDate).toBe('2026-04-13');
  });

  it('the same gesture pages by a week in week mode', () => {
    useCalendarView.setState({ mode: 'week', anchorDate: ANCHOR });
    render(
      <CalendarSwipeArea>
        <div />
      </CalendarSwipeArea>,
    );
    flick(area(), 300, 180);
    expect(useCalendarView.getState().anchorDate).toBe('2026-05-20');
    flick(area(), 180, 320);
    expect(useCalendarView.getState().anchorDate).toBe('2026-05-13');
  });

  it('marks itself as swiping while the finger is down, then settles', () => {
    render(
      <CalendarSwipeArea>
        <div />
      </CalendarSwipeArea>,
    );
    const el = area();
    const base = { pointerId: 1, pointerType: 'touch', isPrimary: true, clientY: 300 };
    fireEvent.pointerDown(el, { ...base, clientX: 300 });
    fireEvent.pointerMove(el, { ...base, clientX: 250 });
    expect(el).toHaveAttribute('data-swiping', 'true');
    fireEvent.pointerUp(el, { ...base, clientX: 250 });
    expect(el).toHaveAttribute('data-swiping', 'false');
  });

  it('plays the enter animation from the side the range came from', () => {
    const stub = installAnimateStub();
    try {
      render(
        <CalendarSwipeArea>
          <div />
        </CalendarSwipeArea>,
      );
      flick(area(), 300, 180);
      expect(stub.animate).toHaveBeenCalledTimes(1);
      const keyframes = stub.animate.mock.calls[0]![0] as Array<{ transform: string }>;
      // Swiping left (forward) pulls the incoming range in from the RIGHT.
      expect(keyframes[0]!.transform).toContain('28px');
    } finally {
      stub.restore();
    }
  });

  it('skips the animation under prefers-reduced-motion but still navigates', () => {
    const stub = installAnimateStub();
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    try {
      render(
        <CalendarSwipeArea>
          <div />
        </CalendarSwipeArea>,
      );
      flick(area(), 300, 180);
      expect(useCalendarView.getState().anchorDate).toBe('2026-06-13');
      expect(stub.animate).not.toHaveBeenCalled();
    } finally {
      stub.restore();
      window.matchMedia = originalMatchMedia;
    }
  });

  it('navigates even when the WAAPI is unavailable', () => {
    // No `element.animate` at all — happy-dom's native state, and the state of
    // any browser without the Web Animations API.
    expect('animate' in HTMLElement.prototype).toBe(false);
    render(
      <CalendarSwipeArea>
        <div />
      </CalendarSwipeArea>,
    );
    flick(area(), 300, 180);
    expect(useCalendarView.getState().anchorDate).toBe('2026-06-13');
  });
});
