import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import '@/lib/i18n';

import type { ReportByEntry } from './computeReport';
import { ReportsTable } from './ReportsTable';

function makeCard(overrides: Partial<Card> = {}): Card {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'card-1',
    name: 'Hourly Card',
    color: '#3B82F6',
    defaultDurationMin: 480,
    rateType: 'hourly',
    hourlyRate: 25,
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
  const now = '2026-05-01T00:00:00.000Z';
  return {
    id: 'entry-1',
    cardId: 'card-1',
    date: '2026-05-14',
    durationMin: 60,
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

function makeRow(overrides: { entry?: Partial<Entry>; card?: Partial<Card>; earnings: number }) {
  const card = makeCard(overrides.card);
  const entry = makeEntry({ cardId: card.id, ...overrides.entry });
  const row: ReportByEntry = { entry, card, earnings: overrides.earnings };
  return row;
}

describe('ReportsTable', () => {
  it('renders the four expected column headers in order', () => {
    render(<ReportsTable byEntry={[makeRow({ earnings: 25 })]} />);
    const headerCells = screen.getAllByRole('columnheader');
    expect(headerCells).toHaveLength(4);
    // i18n in the vitest env falls back to en (no navigator language, no
    // localStorage). Assert against the English locale; the uk/es strings are
    // verified separately by the i18n parity script.
    expect(headerCells[0]!.textContent).toBe('Date');
    expect(headerCells[1]!.textContent).toBe('Project');
    expect(headerCells[2]!.textContent).toBe('Hours');
    expect(headerCells[3]!.textContent).toBe('Sum');
  });

  it('renders exactly one <tr> per byEntry element', () => {
    const rows = [
      makeRow({ entry: { id: 'e1', date: '2026-05-14' }, earnings: 10 }),
      makeRow({ entry: { id: 'e2', date: '2026-05-15' }, earnings: 20 }),
      makeRow({ entry: { id: 'e3', date: '2026-05-16' }, earnings: 30 }),
    ];
    const { container } = render(<ReportsTable byEntry={rows} />);
    const bodyRows = container.querySelectorAll('tbody tr');
    expect(bodyRows).toHaveLength(3);
  });

  it('formats the date cell as dd.MM.yyyy', () => {
    render(
      <ReportsTable
        byEntry={[makeRow({ entry: { id: 'e1', date: '2026-05-14' }, earnings: 25 })]}
      />,
    );
    expect(screen.getByText('14.05.2026')).toBeInTheDocument();
  });

  it("renders the card color chip with the card's color and the card name", () => {
    const row = makeRow({
      entry: { id: 'e1', date: '2026-05-14' },
      card: { id: 'a', name: 'Alpha', color: '#22C55E' },
      earnings: 25,
    });
    const { container } = render(<ReportsTable byEntry={[row]} />);
    const chip = container.querySelector('[data-testid="reports-table-card-chip"]');
    expect(chip).toBeTruthy();
    // happy-dom and jsdom disagree on whether to normalize hex → rgb in
    // `element.style.backgroundColor`. Match the source-of-truth via the
    // inline style attribute, which preserves the literal value.
    const inlineStyle = (chip as HTMLElement).getAttribute('style') ?? '';
    expect(inlineStyle.toLowerCase()).toContain('background-color: #22c55e');
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('renders hours and sum cells for each entry', () => {
    const rows = [
      makeRow({
        entry: { id: 'e1', date: '2026-05-14', durationMin: 165 },
        card: { id: 'a', name: 'Alpha', hourlyRate: 25 },
        earnings: 68.75,
      }),
      makeRow({
        entry: { id: 'e2', date: '2026-05-15', durationMin: 240 },
        card: { id: 'b', name: 'Beta', rateType: 'fixed', hourlyRate: null, fixedTotal: 1500 },
        earnings: 1500,
      }),
    ];
    render(<ReportsTable byEntry={rows} />);
    expect(screen.getByText('2H 45M')).toBeInTheDocument();
    expect(screen.getByText('4H 0M')).toBeInTheDocument();
    expect(screen.getByText(/68\.75 EUR/)).toBeInTheDocument();
    expect(screen.getByText(/1500\.00 EUR/)).toBeInTheDocument();
  });

  it('supports multiple entries with different cards on the same day (one row each)', () => {
    const rows = [
      makeRow({
        entry: { id: 'e1', date: '2026-05-14', durationMin: 60 },
        card: { id: 'a', name: 'Alpha', color: '#3B82F6' },
        earnings: 10,
      }),
      makeRow({
        entry: { id: 'e2', date: '2026-05-14', durationMin: 120 },
        card: { id: 'b', name: 'Beta', color: '#22C55E' },
        earnings: 40,
      }),
    ];
    const { container } = render(<ReportsTable byEntry={rows} />);
    const bodyRows = container.querySelectorAll('tbody tr');
    expect(bodyRows).toHaveLength(2);
    // Both rows show the same date, but different cards.
    bodyRows.forEach((row) => {
      expect(within(row as HTMLElement).getByText('14.05.2026')).toBeInTheDocument();
    });
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});
