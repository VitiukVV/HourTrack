import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import { MonthPicker } from './MonthPicker';

describe('MonthPicker', () => {
  it('renders the trigger label with the localized month + year for `value`', () => {
    render(<MonthPicker value="2026-05-14" onChange={vi.fn()} />);
    const trigger = screen.getByTestId('month-picker-trigger');
    // Default locale in the vitest env is `en` (no navigator, no localStorage).
    expect(trigger.textContent).toContain('May 2026');
  });

  it('clicking a month cell calls onChange with YYYY-MM-01', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MonthPicker value="2026-05-14" onChange={onChange} />);

    await user.click(screen.getByTestId('month-picker-trigger'));
    // March = index 2
    await user.click(screen.getByTestId('month-picker-cell-2'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2026-03-01');
  });

  it('clicking a different month (December) emits YYYY-12-01', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MonthPicker value="2026-05-14" onChange={onChange} />);

    await user.click(screen.getByTestId('month-picker-trigger'));
    // December = index 11
    await user.click(screen.getByTestId('month-picker-cell-11'));

    expect(onChange).toHaveBeenCalledWith('2026-12-01');
  });

  it('year stepper updates the visible browse year (selection no longer highlighted there)', async () => {
    const user = userEvent.setup();
    render(<MonthPicker value="2026-05-14" onChange={vi.fn()} />);

    await user.click(screen.getByTestId('month-picker-trigger'));
    expect(screen.getByTestId('month-picker-year-label').textContent).toBe('2026');

    // Step forward to 2027 — the May cell should no longer be aria-selected
    // because the value (May 2026) is not in the visible year (2027).
    await user.click(screen.getByTestId('month-picker-year-next'));
    expect(screen.getByTestId('month-picker-year-label').textContent).toBe('2027');
    expect(screen.getByTestId('month-picker-cell-4')).toHaveAttribute('aria-selected', 'false');
  });

  it('year stepper crosses years and emits the new year on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MonthPicker value="2026-05-14" onChange={onChange} />);

    await user.click(screen.getByTestId('month-picker-trigger'));
    await user.click(screen.getByTestId('month-picker-year-prev'));
    await user.click(screen.getByTestId('month-picker-year-prev'));
    expect(screen.getByTestId('month-picker-year-label').textContent).toBe('2024');

    // Click January 2024
    await user.click(screen.getByTestId('month-picker-cell-0'));
    expect(onChange).toHaveBeenCalledWith('2024-01-01');
  });
});
