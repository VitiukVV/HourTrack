import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/lib/i18n';

import { ReportsMetrics } from './ReportsMetrics';

describe('ReportsMetrics', () => {
  it('renders Total time using formatDuration and Total earnings to 2 decimals', () => {
    render(<ReportsMetrics totalDurationMin={2550} totalEarnings={1275} monthlyContribution={0} />);
    // 2550 min = 42h 30m
    expect(screen.getByText(/42h 30m/)).toBeInTheDocument();
    expect(screen.getByText(/1275\.00\s*EUR/)).toBeInTheDocument();
  });

  it('renders 0h 0m and 0.00 EUR for zero values', () => {
    render(<ReportsMetrics totalDurationMin={0} totalEarnings={0} monthlyContribution={0} />);
    expect(screen.getByText(/0h 0m/)).toBeInTheDocument();
    expect(screen.getByText(/0\.00\s*EUR/)).toBeInTheDocument();
  });

  it('S29 Task 20: shows the monthly-retainer sub-line only when non-zero', () => {
    const { rerender } = render(
      <ReportsMetrics totalDurationMin={100} totalEarnings={500} monthlyContribution={0} />,
    );
    expect(screen.queryByTestId('reports-metrics-monthly-contribution')).not.toBeInTheDocument();

    rerender(
      <ReportsMetrics totalDurationMin={100} totalEarnings={500} monthlyContribution={250} />,
    );
    const line = screen.getByTestId('reports-metrics-monthly-contribution');
    expect(line).toBeInTheDocument();
    expect(line).toHaveTextContent(/250\.00\s*EUR/);
  });
});
