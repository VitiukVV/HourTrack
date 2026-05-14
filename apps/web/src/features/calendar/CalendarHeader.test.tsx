import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format } from 'date-fns';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '@/lib/i18n';

import { CalendarHeader } from './CalendarHeader';
import { useCalendarView } from './calendarStore';

beforeEach(() => {
  sessionStorage.clear();
  useCalendarView.setState({ mode: 'month', anchorDate: '2026-05-14' });
});

afterEach(() => {
  sessionStorage.clear();
});

describe('CalendarHeader', () => {
  it('renders the Month and Week toggle controls', () => {
    render(<CalendarHeader />);
    expect(screen.getByRole('tab', { name: /Month/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Week/i })).toBeInTheDocument();
  });

  it('renders Today, Previous and Next nav controls', () => {
    render(<CalendarHeader />);
    expect(screen.getByRole('button', { name: /Today/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/i })).toBeInTheDocument();
  });

  it('shows localized month + year in month mode title', () => {
    render(<CalendarHeader />);
    // Default i18next locale fallbacks to en here; in English May 2026 looks like "May 2026".
    expect(screen.getByTestId('calendar-title').textContent).toMatch(/2026/);
  });

  it('clicking Next increments anchor by one month in month mode', async () => {
    const user = userEvent.setup();
    render(<CalendarHeader />);
    await user.click(screen.getByRole('button', { name: /Next/i }));
    expect(useCalendarView.getState().anchorDate).toBe('2026-06-14');
  });

  it('clicking Previous decrements anchor by one month in month mode', async () => {
    const user = userEvent.setup();
    render(<CalendarHeader />);
    await user.click(screen.getByRole('button', { name: /Previous/i }));
    expect(useCalendarView.getState().anchorDate).toBe('2026-04-14');
  });

  it('clicking Today resets anchor to system date', async () => {
    const user = userEvent.setup();
    render(<CalendarHeader />);
    await user.click(screen.getByRole('button', { name: /Today/i }));
    expect(useCalendarView.getState().anchorDate).toBe(format(new Date(), 'yyyy-MM-dd'));
  });

  it('clicking Week toggles store mode to week', async () => {
    const user = userEvent.setup();
    render(<CalendarHeader />);
    await user.click(screen.getByRole('tab', { name: /Week/i }));
    expect(useCalendarView.getState().mode).toBe('week');
  });

  it('week mode title shows DD.MM – DD.MM range', async () => {
    useCalendarView.setState({ mode: 'week', anchorDate: '2026-05-14' }); // Thu 14 May → Mon 11 May – Sun 17 May
    render(<CalendarHeader />);
    const title = screen.getByTestId('calendar-title').textContent ?? '';
    expect(title).toMatch(/11\.05/);
    expect(title).toMatch(/17\.05/);
  });
});
