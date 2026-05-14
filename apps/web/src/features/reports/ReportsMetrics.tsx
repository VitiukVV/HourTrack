import { useTranslation } from 'react-i18next';

import { formatDuration } from '@hourtrack/shared-utils';

/**
 * Two large summary cards at the top of /reports:
 *   - Total time (formatted via `formatDuration`)
 *   - Total earnings (`.toFixed(2)` + " EUR")
 *
 * Keep this presentational — all data comes from `useReportData()` upstream.
 */

interface ReportsMetricsProps {
  totalDurationMin: number;
  totalEarnings: number;
}

export function ReportsMetrics({ totalDurationMin, totalEarnings }: ReportsMetricsProps) {
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
      </div>
    </div>
  );
}
