import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import { WeekPicker } from './WeekPicker';

describe('WeekPicker', () => {
  it('renders the trigger as "Week N · DD.MM-DD.MM.YYYY" for `value`', () => {
    // 2026-05-14 is a Thursday; ISO week 20; Mon..Sun = 11.05–17.05.2026.
    render(<WeekPicker value="2026-05-14" onChange={vi.fn()} />);
    const trigger = screen.getByTestId('week-picker-trigger');
    expect(trigger.textContent).toContain('Week 20');
    expect(trigger.textContent).toContain('11.05');
    expect(trigger.textContent).toContain('17.05.2026');
  });

  it('opens to a list of weeks for the value month (4-5 entries)', async () => {
    const user = userEvent.setup();
    render(<WeekPicker value="2026-05-14" onChange={vi.fn()} />);

    await user.click(screen.getByTestId('week-picker-trigger'));
    const list = screen.getByTestId('week-picker-weeks');
    const items = list.querySelectorAll('button');
    // May 2026 spans ISO weeks 18..22 → 5 rows.
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(items.length).toBeLessThanOrEqual(6);
  });

  it('clicking a week cell emits the Monday YYYY-MM-DD', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WeekPicker value="2026-05-14" onChange={onChange} />);

    await user.click(screen.getByTestId('week-picker-trigger'));
    // The week of 2026-05-04 (Mon) is part of May 2026.
    await user.click(screen.getByTestId('week-picker-cell-2026-05-04'));

    expect(onChange).toHaveBeenCalledWith('2026-05-04');
  });

  it('month stepper navigates and shows weeks for the new month', async () => {
    const user = userEvent.setup();
    render(<WeekPicker value="2026-05-14" onChange={vi.fn()} />);

    await user.click(screen.getByTestId('week-picker-trigger'));
    expect(screen.getByTestId('week-picker-month-label').textContent).toBe('May 2026');

    await user.click(screen.getByTestId('week-picker-month-next'));
    expect(screen.getByTestId('week-picker-month-label').textContent).toBe('June 2026');

    // June 2026 starts Monday 2026-06-01 → that cell must exist.
    expect(screen.getByTestId('week-picker-cell-2026-06-01')).toBeInTheDocument();
  });

  it('marks the value-week cell as aria-selected when visible', async () => {
    const user = userEvent.setup();
    // 2026-05-14 → Monday is 2026-05-11.
    render(<WeekPicker value="2026-05-14" onChange={vi.fn()} />);
    await user.click(screen.getByTestId('week-picker-trigger'));
    const selectedCell = screen.getByTestId('week-picker-cell-2026-05-11');
    expect(selectedCell).toHaveAttribute('aria-selected', 'true');
  });
});
