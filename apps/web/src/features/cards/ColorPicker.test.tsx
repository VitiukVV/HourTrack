import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// The picker's custom-colour labels are interpolated (`color {{hex}}
// (current)`), so this suite needs the real i18n instance rather than the
// key-echo fallback.
import '@/lib/i18n';

import { CARD_COLORS } from '@/lib/colors';
import { ColorPicker } from './ColorPicker';

describe('ColorPicker — presets', () => {
  it('renders one swatch per CARD_COLORS entry, in contract order', () => {
    render(<ColorPicker value="#2563EB" onChange={vi.fn()} />);
    const swatches = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? '')
      .filter((label) => CARD_COLORS.some((hex) => label.includes(hex)));
    expect(swatches).toHaveLength(CARD_COLORS.length);
    for (const [index, hex] of CARD_COLORS.entries()) {
      expect(swatches[index]).toContain(hex);
    }
  });

  it('renders each swatch with its hex as the aria-label', () => {
    render(<ColorPicker value="#2563EB" onChange={vi.fn()} />);
    for (const hex of CARD_COLORS) {
      expect(screen.getByRole('button', { name: new RegExp(hex, 'i') })).toBeInTheDocument();
    }
  });

  it('marks the selected swatch with aria-pressed=true', () => {
    render(<ColorPicker value="#DC2626" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /#DC2626/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /#2563EB/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('clicking a swatch calls onChange with the hex', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorPicker value="#2563EB" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /#CA8A04/i }));
    expect(onChange).toHaveBeenCalledWith('#CA8A04');
  });
});

// ---------------------------------------------------------------------------
// 001-cards-order-colors — the custom colour controls (FR-009, FR-009a/b/c).
// ---------------------------------------------------------------------------

describe('ColorPicker — custom colour', () => {
  it('shows the current colour as a leading selected swatch when it is not a preset', () => {
    render(<ColorPicker value="#123456" onChange={vi.fn()} />);

    const current = screen.getByRole('button', { name: /#123456/i });
    expect(current).toHaveAttribute('aria-pressed', 'true');
    // And it is the first swatch in the group, ahead of the presets.
    const first = screen.getAllByRole('button')[0];
    expect(first).toBe(current);
  });

  it('pre-fills the hex field with the current colour (FR-009b)', () => {
    render(<ColorPicker value="#123456" onChange={vi.fn()} />);
    expect(screen.getByLabelText(/hex/i)).toHaveValue('#123456');
  });

  it('pre-fills the hex field with the selected preset too', () => {
    render(<ColorPicker value="#0C74B0" onChange={vi.fn()} />);
    expect(screen.getByLabelText(/hex/i)).toHaveValue('#0C74B0');
  });

  it('accepts a typed hex and reports it uppercased', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorPicker value="#2563EB" onChange={onChange} />);

    const field = screen.getByLabelText(/hex/i);
    await user.clear(field);
    await user.type(field, '#8e24aa');

    expect(onChange).toHaveBeenLastCalledWith('#8E24AA');
  });

  it('does not report a half-typed hex', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorPicker value="#2563EB" onChange={onChange} />);

    const field = screen.getByLabelText(/hex/i);
    await user.clear(field);
    await user.type(field, '#8e2');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts a change from the native colour input', () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#2563EB" onChange={onChange} />);

    const native = screen.getByLabelText(/custom/i);
    expect(native).toHaveAttribute('type', 'color');
    // Browsers hand back a lowercase hex from the OS picker.
    fireEvent.change(native, { target: { value: '#8e24aa' } });

    expect(onChange).toHaveBeenLastCalledWith('#8E24AA');
  });

  it('keeps both custom controls at the 44px minimum target', () => {
    render(<ColorPicker value="#2563EB" onChange={vi.fn()} />);

    for (const control of [screen.getByLabelText(/custom/i), screen.getByLabelText(/hex/i)]) {
      expect(control.className).toMatch(/min-h-\[44px\]/);
    }
  });
});

describe('ColorPicker — contrast advisory (FR-009a/c)', () => {
  it('says nothing for a colour that reaches 4.5:1', () => {
    render(<ColorPicker value="#0C74B0" onChange={vi.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('warns for a colour no label can rescue', () => {
    // The retired sky blue: 4.10 against white, 4.36 against dark.
    render(<ColorPicker value="#0284C7" onChange={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('is advisory only — nothing is disabled by the warning', () => {
    render(<ColorPicker value="#0284C7" onChange={vi.fn()} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toBeDisabled();
    }
    expect(screen.getByLabelText(/hex/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/custom/i)).not.toBeDisabled();
  });
});
