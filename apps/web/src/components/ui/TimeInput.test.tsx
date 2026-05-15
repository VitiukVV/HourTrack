import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TimeInput, minutesToHHMM, parseHHMM } from './TimeInput';

/**
 * S16 -- TimeInput primitive. The component wraps `<input type="time">`
 * and exposes a numeric minutes-since-midnight API. It's shipped this
 * sprint but NOT mounted into any form; S16b's CardForm + EntryEditor
 * are the first consumers. These tests cover the unit contract.
 */

describe('minutesToHHMM', () => {
  it('round-trips 600 to 10:00', () => {
    expect(minutesToHHMM(600)).toBe('10:00');
  });

  it('zero-pads both hours and minutes', () => {
    expect(minutesToHHMM(0)).toBe('00:00');
    expect(minutesToHHMM(9)).toBe('00:09');
    expect(minutesToHHMM(60)).toBe('01:00');
    expect(minutesToHHMM(125)).toBe('02:05');
  });

  it('handles the upper boundary (1439 = 23:59)', () => {
    expect(minutesToHHMM(1439)).toBe('23:59');
  });

  it('clamps out-of-range values rather than crashing', () => {
    // Negative wraps to 00:00; over-range wraps to 23:59. The form layer
    // is responsible for proper validation; this is defense-in-depth so a
    // stale prop never throws inside the input.
    expect(minutesToHHMM(-30)).toBe('00:00');
    expect(minutesToHHMM(1500)).toBe('23:59');
  });

  it('truncates fractional inputs to whole minutes', () => {
    expect(minutesToHHMM(60.9)).toBe('01:00');
  });

  it('falls back to 00:00 for non-finite inputs', () => {
    expect(minutesToHHMM(Number.NaN)).toBe('00:00');
    expect(minutesToHHMM(Number.POSITIVE_INFINITY)).toBe('00:00');
  });
});

describe('parseHHMM', () => {
  it('round-trips 10:00 back to 600', () => {
    expect(parseHHMM('10:00')).toBe(600);
  });

  it('accepts zero-padded and one-digit hour forms', () => {
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('1:30')).toBe(90);
    expect(parseHHMM('23:59')).toBe(1439);
  });

  it('returns null for empty / unparseable inputs', () => {
    expect(parseHHMM('')).toBeNull();
    expect(parseHHMM('not-a-time')).toBeNull();
    expect(parseHHMM('10:60')).toBeNull(); // minute out of range
    expect(parseHHMM('25:00')).toBeNull(); // hour out of range
    expect(parseHHMM('10')).toBeNull(); // no colon
  });
});

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
