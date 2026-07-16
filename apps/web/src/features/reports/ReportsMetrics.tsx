import { useTranslation } from 'react-i18next';

import { formatDuration } from '@hourtrack/shared-utils';

/**
 * Two large summary cards at the top of /reports:
 *   - Total time (formatted via `formatDuration`)
 *   - Total earnings (`.toFixed(2)` + " EUR")
 *
 * S29 Task 20: when the report includes monthly-retainer income, the earnings
 * card gains a sub-line breaking out the retainer portion
 * (`computeReport().monthlyContribution`, parked since S21). Rendered only
 * when non-zero so hourly/fixed-only reports stay uncluttered.
 *
 * Keep this presentational — all data comes from `useReportData()` upstream.
 */

interface ReportsMetricsProps {
  totalDurationMin: number;
  totalEarnings: number;
  /** Sum of the per-entry monthly-retainer shares in range. 0 for no monthly cards. */
  monthlyContribution: number;
}

export function ReportsMetrics({
  totalDurationMin,
  totalEarnings,
  monthlyContribution,
}: ReportsMetricsProps) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="reports-metrics">
      <div className="border-border bg-card rounded-md border p-4">
        <p className="text-muted-foreground text-sm">{t('reports.metrics.totalTime')}</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight">
          {formatDuration(totalDurationMin)}
        </p>
      </div>
      <div className="border-border bg-card rounded-md border p-4">
        <p className="text-muted-foreground text-sm">{t('reports.metrics.totalEarnings')}</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight">{totalEarnings.toFixed(2)} EUR</p>
        {monthlyContribution > 0 && (
          <p
            className="text-muted-foreground mt-1 text-xs"
            data-testid="reports-metrics-monthly-contribution"
          >
            {t('reports.metrics.monthlyContribution')}: {monthlyContribution.toFixed(2)} EUR
          </p>
        )}
      </div>
    </div>
  );
}
