import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/lib/i18n';

import { ReportsMetrics } from './ReportsMetrics';

describe('ReportsMetrics', () => {
  it('renders Total time using formatDuration and Total earnings to 2 decimals', () => {
    render(<ReportsMetrics totalDurationMin={2550} totalEarnings={1275} />);
    // 2550 min = 42h 30m
    expect(screen.getByText(/42h 30m/)).toBeInTheDocument();
    expect(screen.getByText(/1275\.00\s*EUR/)).toBeInTheDocument();
  });

  it('renders 0h 0m and 0.00 EUR for zero values', () => {
    render(<ReportsMetrics totalDurationMin={0} totalEarnings={0} />);
    expect(screen.getByText(/0h 0m/)).toBeInTheDocument();
    expect(screen.getByText(/0\.00\s*EUR/)).toBeInTheDocument();
  });
});
