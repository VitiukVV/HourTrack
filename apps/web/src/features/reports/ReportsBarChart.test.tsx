import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Card } from '@hourtrack/shared-types';

import { ReportsBarChart } from './ReportsBarChart';

function makeCard(id: string, name: string, color: string): Card {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id,
    name,
    color,
    defaultDurationMin: 480,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('ReportsBarChart', () => {
  it('renders the chart wrapper without throwing for non-empty data', () => {
    const cards = [makeCard('a', 'Alpha', '#3B82F6'), makeCard('b', 'Beta', '#22C55E')];
    const byDay = [
      { date: '2026-05-14', durationMin: 180, perCardDurationMin: { a: 60, b: 120 } },
      { date: '2026-05-15', durationMin: 90, perCardDurationMin: { a: 30, b: 60 } },
    ];
    const { container } = render(<ReportsBarChart byDay={byDay} cards={cards} />);
    // ResponsiveContainer renders a wrapper div even in test env
    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy();
  });

  it('handles empty byDay by rendering an empty-state placeholder', () => {
    const { container } = render(<ReportsBarChart byDay={[]} cards={[]} />);
    expect(container.querySelector('[data-testid="bar-chart-empty"]')).toBeTruthy();
  });
});
