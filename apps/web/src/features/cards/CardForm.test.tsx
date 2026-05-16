import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import { CardForm } from './CardForm';

describe('CardForm — create mode', () => {
  it('renders blank fields with hourly default', () => {
    render(<CardForm mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/Name/i)).toHaveValue('');
    // S20 Task 20 — rate type is now a Select. The trigger renders the
    // current value as its text content (Radix `SelectValue`).
    const rateTrigger = screen.getByTestId('cardform-rate-type-trigger');
    expect(rateTrigger.textContent).toMatch(/Hourly/i);
    // hourly fields visible, fixed hidden
    expect(screen.getByLabelText(/Hourly rate/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Fixed total/i)).not.toBeInTheDocument();
  });

  it('switching rate type to fixed hides hourlyRate and shows fixedTotal', async () => {
    const user = userEvent.setup();
    render(<CardForm mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);

    // S20 Task 20 — open the Select, pick Fixed.
    await user.click(screen.getByTestId('cardform-rate-type-trigger'));
    await user.click(screen.getByTestId('cardform-rate-type-option-fixed'));

    expect(screen.getByLabelText(/Fixed total/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Hourly rate/i)).not.toBeInTheDocument();
  });

  it('shows validation error when submitting with empty name', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CardForm mode="create" onSave={onSave} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(await screen.findByText(/Name is required/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows validation error when hourly card submitted without hourlyRate', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CardForm mode="create" onSave={onSave} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Name/i), 'Raquel');
    // Clear default hourlyRate
    const rateInput = screen.getByLabelText(/Hourly rate/i);
    await user.clear(rateInput);

    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(
      await screen.findByText(/Hourly rate is required|Hourly rate must be greater/i),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with parsed duration and rate fields for a valid hourly card', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CardForm mode="create" onSave={onSave} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Name/i), 'Raquel');

    const hoursInput = screen.getByLabelText(/^Hours$/i);
    await user.clear(hoursInput);
    await user.type(hoursInput, '4');

    const minutesInput = screen.getByLabelText(/^Minutes$/i);
    await user.clear(minutesInput);
    await user.type(minutesInput, '30');

    const rateInput = screen.getByLabelText(/Hourly rate/i);
    await user.clear(rateInput);
    await user.type(rateInput, '25');

    // Pick the blue color (#2563EB) via its aria-label
    await user.click(screen.getByRole('button', { name: /color #2563EB/i }));

    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      name: 'Raquel',
      color: '#2563EB',
      defaultDurationMin: 270, // 4*60 + 30
      // S16b: new-card seed is 540 (09:00) — user did not touch the TimeInput
      defaultStartMinutes: 540,
      rateType: 'hourly',
      hourlyRate: 25,
      fixedTotal: null,
    });
  });

  // S16b: visible TimeInput control for `defaultStartMinutes`.
  it('defaults the start time to 09:00 (540 min) in create mode and round-trips a manual edit', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CardForm mode="create" onSave={onSave} onCancel={vi.fn()} />);

    const timeInput = screen.getByLabelText(/Default start time/i) as HTMLInputElement;
    expect(timeInput.value).toBe('09:00');

    // Change to 14:30. `<input type="time">` has browser-specific keyboard
    // behaviour that `userEvent.type` doesn't reliably emulate in happy-dom
    // (it ends up at HH:MM partials like 09:59 instead of 14:30). Use
    // `fireEvent.change` to set the value directly — this is the form the
    // TimeInput component itself receives from the native picker.
    fireEvent.change(timeInput, { target: { value: '14:30' } });

    await user.type(screen.getByLabelText(/Name/i), 'Raquel');
    const rateInput = screen.getByLabelText(/Hourly rate/i);
    await user.clear(rateInput);
    await user.type(rateInput, '25');
    await user.click(screen.getByRole('button', { name: /color #2563EB/i }));
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0]?.[0];
    expect(payload.defaultStartMinutes).toBe(14 * 60 + 30); // 870
  });

  // S16b: in edit mode, the existing card's defaultStartMinutes pre-fills.
  it('pre-fills the start time from defaultValues in edit mode', () => {
    render(
      <CardForm
        mode="edit"
        defaultValues={{
          name: 'Existing',
          color: '#16A34A',
          defaultDurationMin: 120,
          defaultStartMinutes: 8 * 60 + 15, // 08:15
          rateType: 'hourly',
          hourlyRate: 30,
          fixedTotal: null,
          defaultNote: '',
        }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const timeInput = screen.getByLabelText(/Default start time/i) as HTMLInputElement;
    expect(timeInput.value).toBe('08:15');
  });

  it('calls onSave with fixed payload when fixed rate type selected', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CardForm mode="create" onSave={onSave} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Name/i), 'Project');
    // S20 Task 20 — drive the Select to pick Fixed.
    await user.click(screen.getByTestId('cardform-rate-type-trigger'));
    await user.click(screen.getByTestId('cardform-rate-type-option-fixed'));

    const fixedInput = screen.getByLabelText(/Fixed total/i);
    await user.clear(fixedInput);
    await user.type(fixedInput, '1500');

    await user.click(screen.getByRole('button', { name: /color #DC2626/i }));

    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      name: 'Project',
      rateType: 'fixed',
      hourlyRate: null,
      fixedTotal: 1500,
    });
  });

  it('Cancel button invokes onCancel without onSave', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<CardForm mode="create" onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('CardForm — edit mode', () => {
  it('pre-populates fields from the supplied card', () => {
    render(
      <CardForm
        mode="edit"
        defaultValues={{
          name: 'Existing',
          color: '#16A34A',
          defaultDurationMin: 90, // 1H 30M
          rateType: 'hourly',
          hourlyRate: 30,
          fixedTotal: null,
          defaultNote: 'pre-filled',
        }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Name/i)).toHaveValue('Existing');
    expect(screen.getByLabelText(/^Hours$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^Minutes$/i)).toHaveValue(30);
    expect(screen.getByLabelText(/Hourly rate/i)).toHaveValue(30);
    expect(screen.getByLabelText(/Default note/i)).toHaveValue('pre-filled');
  });
});

// S19 (Task 4) — phone-friendly numeric input + select-on-focus + default 0.
describe('CardForm — S19 numeric input UX', () => {
  it('renders hours=0 and minutes=0 by default in create mode (UR-19-1)', () => {
    render(<CardForm mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/^Hours$/i)).toHaveValue(0);
    expect(screen.getByLabelText(/^Minutes$/i)).toHaveValue(0);
  });

  it('exposes inputMode="numeric" + pattern="[0-9]*" + enterKeyHint="done" on hours/minutes', () => {
    render(<CardForm mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    const hours = screen.getByLabelText(/^Hours$/i);
    const minutes = screen.getByLabelText(/^Minutes$/i);
    for (const el of [hours, minutes]) {
      expect(el).toHaveAttribute('inputmode', 'numeric');
      expect(el).toHaveAttribute('pattern', '[0-9]*');
      expect(el).toHaveAttribute('enterkeyhint', 'done');
      expect(el).toHaveAttribute('type', 'number');
    }
  });

  it('selects the existing hours value on focus so the next keystroke replaces it', async () => {
    const user = userEvent.setup();
    render(
      <CardForm
        mode="edit"
        defaultValues={{
          name: 'Existing',
          color: '#16A34A',
          defaultDurationMin: 270, // 4h 30m
          rateType: 'hourly',
          hourlyRate: 20,
          fixedTotal: null,
          defaultNote: null,
        }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const hours = screen.getByLabelText(/^Hours$/i) as HTMLInputElement;
    // Spy on the .select() call — RTL/userEvent's focus event triggers the
    // `onFocus` handler which invokes `e.target.select()`. We can't observe
    // the selection range directly on number inputs in happy-dom (no
    // text-selection API on `<input type="number">`), but the spy on the
    // prototype confirms the handler ran.
    const spy = vi.spyOn(HTMLInputElement.prototype, 'select');
    await user.click(hours);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('edit-mode preserves the existing hours/minutes split (not reset to 0)', () => {
    render(
      <CardForm
        mode="edit"
        defaultValues={{
          name: 'Existing',
          color: '#16A34A',
          defaultDurationMin: 75, // 1h 15m
          rateType: 'hourly',
          hourlyRate: 20,
          fixedTotal: null,
          defaultNote: null,
        }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/^Hours$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^Minutes$/i)).toHaveValue(15);
  });
});

// S19 (Task 8) — legacy color compatibility in edit mode.
describe('CardForm — legacy color migration (S19 Task 8)', () => {
  it('accepts a legacy hex on save when the card was loaded with one', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <CardForm
        mode="edit"
        defaultValues={{
          name: 'Legacy',
          // `#3B82F6` (pre-S19 blue) is no longer in the palette.
          color: '#3B82F6',
          defaultDurationMin: 60,
          rateType: 'hourly',
          hourlyRate: 20,
          fixedTotal: null,
          defaultNote: null,
        }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0]?.[0];
    expect(payload.color).toBe('#3B82F6'); // unchanged, legacy preserved
  });

  it('normalises the card when the user picks a new-palette color', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <CardForm
        mode="edit"
        defaultValues={{
          name: 'Legacy',
          color: '#3B82F6',
          defaultDurationMin: 60,
          rateType: 'hourly',
          hourlyRate: 20,
          fixedTotal: null,
          defaultNote: null,
        }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    // Pick the new-palette blue.
    await user.click(screen.getByRole('button', { name: /color #2563EB/i }));
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0]?.[0];
    expect(payload.color).toBe('#2563EB');
  });
});
