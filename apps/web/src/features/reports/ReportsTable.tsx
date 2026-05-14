import { useTranslation } from 'react-i18next';

import { formatDuration } from '@hourtrack/shared-utils';

import type { ReportByCard } from './computeReport';

/**
 * Per-card summary table — one row per selected card (including cards with
 * zero entries in the period so the user sees "no activity"). Sorted by
 * earnings descending upstream by `computeReport`.
 *
 * Columns:
 *   - Card     (color chip + name)
 *   - Time     (formatDuration)
 *   - Rate     (either "{hourlyRate} EUR/h" or "Fixed total: {fixedTotal} EUR")
 *   - Earnings (`.toFixed(2)` + " EUR")
 */

interface ReportsTableProps {
  byCard: ReportByCard[];
}

export function ReportsTable({ byCard }: ReportsTableProps) {
  const { t } = useTranslation();

  return (
    <div
      className="border-border bg-card overflow-x-auto rounded-md border"
      data-testid="reports-table"
    >
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-muted-foreground text-left">
            <th className="px-3 py-2 font-medium">{t('reports.table.card')}</th>
            <th className="px-3 py-2 font-medium">{t('reports.table.time')}</th>
            <th className="px-3 py-2 font-medium">{t('reports.table.rate')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('reports.table.earnings')}</th>
          </tr>
        </thead>
        <tbody>
          {byCard.map(({ card, durationMin, earnings }) => {
            const rateLabel =
              card.rateType === 'hourly'
                ? t('reports.rate.hourly', { rate: card.hourlyRate ?? 0 })
                : t('reports.rate.fixed', { total: card.fixedTotal ?? 0 });
            return (
              <tr key={card.id} className="border-border border-t">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: card.color }}
                    />
                    {card.name}
                  </span>
                </td>
                <td className="px-3 py-2">{formatDuration(durationMin)}</td>
                <td className="px-3 py-2">{rateLabel}</td>
                <td className="px-3 py-2 text-right">{earnings.toFixed(2)} EUR</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
