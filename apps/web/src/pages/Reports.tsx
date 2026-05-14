import { useTranslation } from 'react-i18next';

import { CsvExportButton } from '@/features/reports/CsvExportButton';
import { ReportsBarChart } from '@/features/reports/ReportsBarChart';
import { ReportsFilters } from '@/features/reports/ReportsFilters';
import { ReportsMetrics } from '@/features/reports/ReportsMetrics';
import { ReportsPieChart } from '@/features/reports/ReportsPieChart';
import { ReportsTable } from '@/features/reports/ReportsTable';
import { useReportData } from '@/features/reports/useReportData';

/**
 * /reports page assembly.
 *
 * Layout:
 *   - Sticky `<ReportsFilters />` at the top.
 *   - Below: metrics → bar chart → pie chart → table → CSV export.
 *
 * The single `useReportData` hook drives every section so the panels stay in
 * lock-step with the filter state. When no entries match the filters, render
 * an empty-state card and disable the CSV export button.
 */
export function ReportsPage() {
  const { t } = useTranslation();
  const reportQuery = useReportData();

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('nav.reports')}</h1>
        {reportQuery.data && (
          <CsvExportButton
            entries={reportQuery.data.filteredEntries}
            cards={reportQuery.data.cards}
            start={reportQuery.data.start}
            end={reportQuery.data.end}
          />
        )}
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
  const hasData = data.filteredEntries.length > 0;

  if (!hasData) {
    return (
      <div
        className="border-border bg-card flex flex-col items-center justify-center gap-1 rounded-md border p-8 text-center"
        data-testid="reports-empty"
      >
        <p className="text-sm font-medium">{t('reports.empty.title')}</p>
        <p className="text-muted-foreground text-sm">{t('reports.empty.body')}</p>
      </div>
    );
  }

  return (
    <>
      <ReportsMetrics
        totalDurationMin={data.totals.durationMin}
        totalEarnings={data.totals.earnings}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ReportsBarChart byDay={data.byDay} cards={data.cards} />
        <ReportsPieChart byCard={data.byCard} />
      </div>
      <ReportsTable byCard={data.byCard} />
    </>
  );
}
