import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { EntryChip } from './EntryChip';

function makeCard(overrides: Partial<Card> = {}): Card {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'card-1',
    name: 'Raquel',
    color: '#EF4444',
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

  it('keeps color chip rendering regardless of variant', () => {
    const { rerender } = render(
      <EntryChip entry={makeEntry()} card={makeCard({ color: '#22C55E' })} />,
    );
    // bar variant
    let chip = screen.getByTestId('entry-chip');
    expect(chip.querySelector('[aria-hidden="true"]')).toBeTruthy();

    rerender(<EntryChip entry={makeEntry()} card={makeCard({ color: '#22C55E' })} variant="row" />);
    chip = screen.getByTestId('entry-chip');
    expect(chip.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
