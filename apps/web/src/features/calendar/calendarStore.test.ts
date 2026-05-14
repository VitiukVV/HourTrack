import { act } from '@testing-library/react';
import { addMonths, addWeeks, format } from 'date-fns';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CALENDAR_VIEW_STORAGE_KEY, useCalendarView } from './calendarStore';

/**
 * Tests the Zustand store that drives the calendar (month vs week, anchor
 * date, prev/next/today navigation). The anchor is a YYYY-MM-DD string so
 * navigation is timezone-stable.
 */

function resetStore() {
  // Reset to a deterministic anchor date so prev/next math is testable.
  useCalendarView.setState({ mode: 'month', anchorDate: '2026-05-14' });
}

beforeEach(() => {
  sessionStorage.clear();
  resetStore();
});

afterEach(() => {
  sessionStorage.clear();
});

describe('useCalendarView store', () => {
  it('exposes the canonical sessionStorage key', () => {
    expect(CALENDAR_VIEW_STORAGE_KEY).toBe('hourtrack:calendar-view');
  });

  it('has initial state mode=month and a YYYY-MM-DD anchor', () => {
    const { mode, anchorDate } = useCalendarView.getState();
    expect(mode).toBe('month');
    expect(anchorDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('setMode flips between month and week', () => {
    act(() => useCalendarView.getState().setMode('week'));
    expect(useCalendarView.getState().mode).toBe('week');

    act(() => useCalendarView.getState().setMode('month'));
    expect(useCalendarView.getState().mode).toBe('month');
  });

  it('setAnchor accepts a Date object and stores YYYY-MM-DD', () => {
    act(() => useCalendarView.getState().setAnchor(new Date('2026-12-25T10:00:00')));
    expect(useCalendarView.getState().anchorDate).toBe('2026-12-25');
  });

  it('prev in month mode subtracts one month', () => {
    act(() => useCalendarView.getState().prev());
    // 2026-05-14 -> 2026-04-14
    expect(useCalendarView.getState().anchorDate).toBe('2026-04-14');
  });

  it('next in month mode adds one month', () => {
    act(() => useCalendarView.getState().next());
    // 2026-05-14 -> 2026-06-14
    expect(useCalendarView.getState().anchorDate).toBe('2026-06-14');
  });

  it('prev in week mode subtracts one week (7 days)', () => {
    act(() => useCalendarView.getState().setMode('week'));
    const before = useCalendarView.getState().anchorDate;
    act(() => useCalendarView.getState().prev());
    const after = useCalendarView.getState().anchorDate;
    expect(after).toBe(format(addWeeks(new Date(before), -1), 'yyyy-MM-dd'));
  });

  it('next in week mode adds one week (7 days)', () => {
    act(() => useCalendarView.getState().setMode('week'));
    const before = useCalendarView.getState().anchorDate;
    act(() => useCalendarView.getState().next());
    const after = useCalendarView.getState().anchorDate;
    expect(after).toBe(format(addWeeks(new Date(before), 1), 'yyyy-MM-dd'));
  });

  it('goToday resets anchor to today (local)', () => {
    act(() => useCalendarView.getState().setAnchor('2020-01-01'));
    expect(useCalendarView.getState().anchorDate).toBe('2020-01-01');

    act(() => useCalendarView.getState().goToday());
    const today = format(new Date(), 'yyyy-MM-dd');
    expect(useCalendarView.getState().anchorDate).toBe(today);
  });

  it('persists mode + anchorDate to sessionStorage via partialize', () => {
    act(() => {
      useCalendarView.getState().setMode('week');
      useCalendarView.getState().setAnchor('2027-01-15');
    });

    const raw = sessionStorage.getItem(CALENDAR_VIEW_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state: { mode: string; anchorDate: string } };
    expect(parsed.state.mode).toBe('week');
    expect(parsed.state.anchorDate).toBe('2027-01-15');
  });

  // Sanity: chained nav should land on the right month.
  it('next x 3 in month mode equals +3 months', () => {
    const start = useCalendarView.getState().anchorDate;
    act(() => {
      useCalendarView.getState().next();
      useCalendarView.getState().next();
      useCalendarView.getState().next();
    });
    const after = useCalendarView.getState().anchorDate;
    expect(after).toBe(format(addMonths(new Date(start), 3), 'yyyy-MM-dd'));
  });
});
