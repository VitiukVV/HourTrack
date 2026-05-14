import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Card } from '@hourtrack/shared-types';

import '@/lib/i18n';

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

describe('ReportsTable', () => {
  it('renders one row per byCard entry with formatted duration and earnings', () => {
    const cardA = makeCard({ id: 'a', name: 'Alpha', hourlyRate: 25 });
    const cardB = makeCard({
      id: 'b',
      name: 'Beta',
      hourlyRate: null,
      rateType: 'fixed',
      fixedTotal: 1500,
    });
    render(
      <ReportsTable
        byCard={[
          { card: cardA, durationMin: 165, earnings: 68.75 },
          { card: cardB, durationMin: 240, earnings: 1500 },
        ]}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('2H 45M')).toBeInTheDocument();
    expect(screen.getByText('4H 0M')).toBeInTheDocument();
    expect(screen.getByText(/68\.75/)).toBeInTheDocument();
    expect(screen.getByText(/1500\.00/)).toBeInTheDocument();
  });

  it('formats the rate column as "{rate} EUR/h" for hourly cards', () => {
    const card = makeCard({ id: 'a', name: 'A', hourlyRate: 25 });
    render(<ReportsTable byCard={[{ card, durationMin: 60, earnings: 25 }]} />);
    expect(screen.getByText(/25\s*EUR\/h/)).toBeInTheDocument();
  });

  it('formats the rate column as fixed total for fixed-rate cards', () => {
    const card = makeCard({
      id: 'b',
      name: 'B',
      rateType: 'fixed',
      hourlyRate: null,
      fixedTotal: 1000,
    });
    render(<ReportsTable byCard={[{ card, durationMin: 240, earnings: 1000 }]} />);
    expect(screen.getByText(/Fixed\s*total:\s*1000\s*EUR/i)).toBeInTheDocument();
  });

  it('renders empty state when byCard is empty', () => {
    const { container } = render(<ReportsTable byCard={[]} />);
    // No <tr> rows under tbody
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(0);
  });
});
