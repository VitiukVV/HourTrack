import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { EntryChip } from './EntryChip';

function makeCard(overrides: Partial<Card> = {}): Card {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'card-1',
    name: 'Raquel',
    color: '#DC2626',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 15,
    fixedTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  const now = '2026-05-14T08:00:00.000Z';
  return {
    id: 'entry-1',
    cardId: 'card-1',
    date: '2026-05-14',
    startMinutes: 600, // 10:00
    durationMin: 120,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * EntryChip — visual unit tests covering the S16b time-prefix.
 *
 * Both `bar` (MonthView/DayCell) and `row` (WeekView) variants must lead with
 * the entry's start-of-day in HH:MM. Same component, same prefix, two
 * different layouts.
 */
describe('EntryChip — bar variant', () => {
  it('renders the start-time HH:MM prefix on the bar variant', () => {
    render(<EntryChip entry={makeEntry({ startMinutes: 600 })} card={makeCard()} />);

    const chip = screen.getByTestId('entry-chip');
    expect(chip.textContent).toMatch(/10:00/);
    // The dedicated time slot is queryable for downstream assertions.
    expect(within(chip).getByTestId('entry-chip-time')).toHaveTextContent('10:00');
  });

  it('formats 00:00 (midnight) and 23:59 (boundary) correctly', () => {
    const { rerender } = render(
      <EntryChip entry={makeEntry({ startMinutes: 0 })} card={makeCard()} />,
    );
    expect(screen.getByTestId('entry-chip-time')).toHaveTextContent('00:00');

    rerender(<EntryChip entry={makeEntry({ startMinutes: 1439 })} card={makeCard()} />);
    expect(screen.getByTestId('entry-chip-time')).toHaveTextContent('23:59');
  });

  it('keeps the card-name truncation behaviour for long names', () => {
    const longName = 'A really exceptionally long card name that should truncate';
    render(<EntryChip entry={makeEntry()} card={makeCard({ name: longName })} />);

    const chip = screen.getByTestId('entry-chip');
    // truncate utility is applied to the name span; verify the name text
    // still appears (CSS truncation is visual, not content-level).
    expect(chip.textContent).toContain(longName);
  });

  it('falls back to a neutral chip when card is undefined (no crash)', () => {
    render(<EntryChip entry={makeEntry()} card={undefined} />);
    const chip = screen.getByTestId('entry-chip');
    expect(chip.textContent).toMatch(/10:00/);
    // The "…" fallback ellipsis stands in for the missing name.
    expect(chip.textContent).toMatch(/…/);
  });
});

describe('EntryChip — row variant', () => {
  it('renders the start-time HH:MM prefix on the row variant', () => {
    render(
      <EntryChip
        entry={makeEntry({ startMinutes: 8 * 60 + 30 })}
        card={makeCard()}
        variant="row"
      />,
    );

    const chip = screen.getByTestId('entry-chip');
    expect(within(chip).getByTestId('entry-chip-time')).toHaveTextContent('08:30');
  });

  it('still shows note marker when entry.note is non-null', () => {
    render(<EntryChip entry={makeEntry({ note: 'reminder' })} card={makeCard()} variant="row" />);

    expect(screen.getByTestId('note-marker')).toBeInTheDocument();
  });

  it('does NOT show note marker when entry.note is null', () => {
    render(<EntryChip entry={makeEntry({ note: null })} card={makeCard()} variant="row" />);

    expect(screen.queryByTestId('note-marker')).not.toBeInTheDocument();
  });

  it('renders earningsEur when provided', () => {
    render(<EntryChip entry={makeEntry()} card={makeCard()} variant="row" earningsEur={42.5} />);

    const chip = screen.getByTestId('entry-chip');
    expect(chip.textContent).toContain('42.50 EUR');
  });

  it('still surfaces the card color regardless of variant (S19: bg in bar, left-border in row)', () => {
    // S19 Task 12 dropped the leading color dot. The bar variant carries
    // the color as a 20%-alpha background; the row variant carries it as
    // a 4px left border. Either way the inline `style` of the chip /
    // row root encodes the card's color, so the test asserts that the
    // hex appears in an inline-style attribute on the chip subtree.
    const { rerender } = render(
      <EntryChip entry={makeEntry()} card={makeCard({ color: '#16A34A' })} />,
    );
    let chip = screen.getByTestId('entry-chip');
    expect(chip.getAttribute('style')?.toLowerCase()).toContain('#16a34a');

    rerender(<EntryChip entry={makeEntry()} card={makeCard({ color: '#16A34A' })} variant="row" />);
    chip = screen.getByTestId('entry-chip');
    expect(chip.getAttribute('style')?.toLowerCase()).toContain('#16a34a');
  });
});

/**
 * S17 — Clickable chip wiring.
 *
 * When `onEdit` is provided, the chip becomes a `role="button"`, keyboard-
 * activatable, and crucially does NOT bubble its click to ancestor elements
 * (DayCell wraps cells in a click-to-add-entry handler — a chip click must
 * stay scoped to "edit this entry", not "add another entry to the day").
 *
 * When `onEdit` is omitted, the chip stays read-only (current MonthView
 * behaviour pre-S17). This is what guarantees we don't accidentally make
 * the +N-more cell decoration tappable.
 */
describe('EntryChip — S17 onEdit wiring', () => {
  it('renders role="button" + tabIndex=0 when onEdit is provided', () => {
    render(<EntryChip entry={makeEntry()} card={makeCard()} onEdit={() => {}} />);

    const chip = screen.getByTestId('entry-chip');
    expect(chip.getAttribute('role')).toBe('button');
    expect(chip.getAttribute('tabindex')).toBe('0');
  });

  it('is NOT a button when onEdit is omitted (legacy read-only mode)', () => {
    render(<EntryChip entry={makeEntry()} card={makeCard()} />);

    const chip = screen.getByTestId('entry-chip');
    expect(chip.getAttribute('role')).not.toBe('button');
    // tabIndex must be absent so the chip doesn't steal focus from the day
    // cell's keyboard handler in read-only mode.
    expect(chip.getAttribute('tabindex')).toBeNull();
  });

  it('invokes onEdit(entry.id) when clicked', async () => {
    const onEdit = vi.fn();
    render(<EntryChip entry={makeEntry({ id: 'e-42' })} card={makeCard()} onEdit={onEdit} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('entry-chip'));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('e-42');
  });

  it('invokes onEdit on Enter and Space key activation', async () => {
    const onEdit = vi.fn();
    render(<EntryChip entry={makeEntry({ id: 'e-7' })} card={makeCard()} onEdit={onEdit} />);

    const chip = screen.getByTestId('entry-chip');
    chip.focus();

    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    expect(onEdit).toHaveBeenCalledWith('e-7');

    await user.keyboard(' ');
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it('does NOT bubble the click to an ancestor click handler (stopPropagation)', async () => {
    const parentClick = vi.fn();
    const onEdit = vi.fn();
    render(
      <div onClick={parentClick} data-testid="parent">
        <EntryChip entry={makeEntry({ id: 'e-bubble' })} card={makeCard()} onEdit={onEdit} />
      </div>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('entry-chip'));

    expect(onEdit).toHaveBeenCalledWith('e-bubble');
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('row-variant chip is also clickable when onEdit is provided', async () => {
    const onEdit = vi.fn();
    render(
      <EntryChip
        entry={makeEntry({ id: 'e-row' })}
        card={makeCard()}
        variant="row"
        onEdit={onEdit}
      />,
    );

    const chip = screen.getByTestId('entry-chip');
    expect(chip.getAttribute('role')).toBe('button');
    expect(chip.getAttribute('tabindex')).toBe('0');

    const user = userEvent.setup();
    await user.click(chip);

    expect(onEdit).toHaveBeenCalledWith('e-row');
  });
});
