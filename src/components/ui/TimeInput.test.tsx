import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TimeInput } from './TimeInput';

/**
 * S16 -- TimeInput primitive. The component wraps `<input type="time">`
 * and exposes a numeric minutes-since-midnight API. It's shipped this
 * sprint but NOT mounted into any form; S16b's CardForm + EntryEditor
 * are the first consumers. These tests cover the unit contract.
 */

describe('<TimeInput />', () => {
  it('renders the current value in HH:MM (round-trip 600 to "10:00")', () => {
    render(
      <TimeInput value={600} onChange={() => undefined} aria-label="start time" />,
    );
    const input = screen.getByLabelText('start time') as HTMLInputElement;
    expect(input.type).toBe('time');
    expect(input.value).toBe('10:00');
  });

  it('calls onChange with an integer in [0, 1439] when the user picks a new time', () => {
    const handleChange = vi.fn();
    render(
      <TimeInput value={600} onChange={handleChange} aria-label="start time" />,
    );
    const input = screen.getByLabelText('start time') as HTMLInputElement;
    // happy-dom's `<input type="time">` doesn't fully simulate the
    // native picker UI for `userEvent.type` — keystrokes land in the
    // hour/minute segments unpredictably. The real-world contract that
    // matters is "when the input's value changes to a valid HH:MM,
    // onChange fires with the parsed integer." `fireEvent.change`
    // dispatches a synthetic event that React's event tracker sees,
    // which mirrors the picker commit.
    fireEvent.change(input, { target: { value: '14:30' } });
    expect(handleChange).toHaveBeenCalledTimes(1);
    const minutes = handleChange.mock.calls[0]![0];
    expect(minutes).toBe(14 * 60 + 30);
    expect(Number.isInteger(minutes)).toBe(true);
    expect(minutes).toBeGreaterThanOrEqual(0);
    expect(minutes).toBeLessThanOrEqual(1439);
  });

  it('does NOT crash or fire onChange when the input is cleared to empty', () => {
    const handleChange = vi.fn();
    render(
      <TimeInput value={600} onChange={handleChange} aria-label="start time" />,
    );
    const input = screen.getByLabelText('start time') as HTMLInputElement;
    // Native time inputs surface a cleared state as `value === ''`. The
    // wrapper must absorb that (no onChange call, no throw) — the caller's
    // stored value is preserved until the user picks a valid replacement.
    fireEvent.change(input, { target: { value: '' } });
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('respects the `disabled` prop', () => {
    render(
      <TimeInput
        value={600}
        onChange={() => undefined}
        aria-label="start time"
        disabled
      />,
    );
    const input = screen.getByLabelText('start time') as HTMLInputElement;
    expect(input).toBeDisabled();
  });

  it('forwards the `id` prop to the rendered input', () => {
    render(
      <TimeInput value={600} onChange={() => undefined} id="my-time" aria-label="x" />,
    );
    const input = screen.getByLabelText('x') as HTMLInputElement;
    expect(input.id).toBe('my-time');
  });
});
