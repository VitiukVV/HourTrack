import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CARD_COLORS } from '@/lib/colors';
import { ColorPicker } from './ColorPicker';

describe('ColorPicker', () => {
  it('renders exactly 12 swatches, one per CARD_COLORS entry', () => {
    render(<ColorPicker value="#2563EB" onChange={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(CARD_COLORS.length);
  });

  it('renders each swatch with its hex as the aria-label', () => {
    render(<ColorPicker value="#2563EB" onChange={vi.fn()} />);
    for (const hex of CARD_COLORS) {
      expect(screen.getByRole('button', { name: new RegExp(hex, 'i') })).toBeInTheDocument();
    }
  });

  it('marks the selected swatch with aria-pressed=true', () => {
    render(<ColorPicker value="#DC2626" onChange={vi.fn()} />);
    const red = screen.getByRole('button', { name: /#DC2626/i });
    expect(red).toHaveAttribute('aria-pressed', 'true');

    const blue = screen.getByRole('button', { name: /#2563EB/i });
    expect(blue).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a swatch calls onChange with the hex', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorPicker value="#2563EB" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /#CA8A04/i }));
    expect(onChange).toHaveBeenCalledWith('#CA8A04');
  });
});
