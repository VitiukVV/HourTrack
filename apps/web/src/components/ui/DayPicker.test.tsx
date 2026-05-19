import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import { DayPicker } from './DayPicker';

describe('DayPicker', () => {
  it('renders the trigger label with the formatted date for `value`', () => {
    render(<DayPicker value="2026-05-14" onChange={vi.fn()} />);
    const trigger = screen.getByTestId('day-picker-trigger');
    expect(trigger.textContent).toContain('14.05.2026');
  });

  it('clicking a day cell calls onChange with the YYYY-MM-DD key and closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DayPicker value="2026-05-14" onChange={onChange} />);

    await user.click(screen.getByTestId('day-picker-trigger'));
    await user.click(screen.getByTestId('day-picker-cell-2026-05-20'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2026-05-20');
  });

  it('month stepper updates the visible browse month label', async () => {
    const user = userEvent.setup();
    render(<DayPicker value="2026-05-14" onChange={vi.fn()} />);

    await user.click(screen.getByTestId('day-picker-trigger'));
    expect(screen.getByTestId('day-picker-month-label').textContent).toBe('May 2026');

    await user.click(screen.getByTestId('day-picker-month-next'));
    expect(screen.getByTestId('day-picker-month-label').textContent).toBe('June 2026');
  });

  it('cell aria-selected reflects the picked day', async () => {
    const user = userEvent.setup();
    render(<DayPicker value="2026-05-14" onChange={vi.fn()} />);
    await user.click(screen.getByTestId('day-picker-trigger'));
    expect(screen.getByTestId('day-picker-cell-2026-05-14')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('day-picker-cell-2026-05-15')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });
});
