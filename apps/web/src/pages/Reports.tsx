import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { ReportsFilters } from '@/features/reports/ReportsFilters';
import { ReportsMetrics } from '@/features/reports/ReportsMetrics';
import { ReportsTable } from '@/features/reports/ReportsTable';
import { useReportData } from '@/features/reports/useReportData';

/**
 * /reports page assembly.
 *
 * Layout (post-S15):
 *   - `<ReportsFilters />` at the top (period + cards + archived toggle).
 *   - `<ReportsMetrics />` with total hours + total earnings.
 *   - `<ReportsTable />` — one row per entry, columns Date / Project / Hours / Sum.
 *
 * The single `useReportData` hook drives both panels so they stay in lock-step
 * with the filter state. When no entries match the filters, the body short-
 * circuits to the shared `<EmptyState />` with a CTA back to the calendar.
 *
 * S15 removed the CSV export button and the bar/pie charts (Recharts dropped
 * as a dependency entirely). The 2-column chart grid wrapper went with them —
 * the table now sits directly under the metrics card.
 */
export function ReportsPage() {
  const { t } = useTranslation();
  const reportQuery = useReportData();

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('nav.reports')}</h1>
      </header>

      <ReportsFilters />

      {reportQuery.isLoading ? (
        <p className="text-muted-foreground text-sm" data-testid="reports-loading">
          {t('common.loading')}
        </p>
      ) : reportQuery.isError ? (
        <p className="text-destructive text-sm" data-testid="reports-error">
          {String(reportQuery.error)}
        </p>
      ) : reportQuery.data ? (
        <ReportsBody data={reportQuery.data} />
      ) : null}
    </section>
  );
}

interface BodyProps {
  data: NonNullable<ReturnType<typeof useReportData>['data']>;
}

function ReportsBody({ data }: BodyProps) {
  const { t } = useTranslation();
  const hasData = data.byEntry.length > 0;

  if (!hasData) {
    // S13 task #7: route through the shared EmptyState so empty Reports gets
    // a real CTA back to the calendar instead of a wordless dead-end.
    return (
      <EmptyState
        testId="reports-empty"
        title={t('empty.noReportsTitle')}
        body={t('empty.noReportsBody')}
        cta={
          <Button asChild size="sm" variant="outline">
            <Link to="/">{t('empty.noReportsCta')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <ReportsMetrics
        totalDurationMin={data.totals.durationMin}
        totalEarnings={data.totals.earnings}
      />
      <ReportsTable byEntry={data.byEntry} />
    </>
  );
}
