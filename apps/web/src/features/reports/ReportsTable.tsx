import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { formatDuration } from '@hourtrack/shared-utils';

import type { ReportByEntry } from './computeReport';

/**
 * Flat entry-row table for /reports. One `<tr>` per filtered entry; columns:
 *
 *   Date     — `dd.MM.yyyy` (the project's existing display format, also used
 *              by the calendar grids and the bar-chart x-axis pre-S15).
 *   Project  — color chip + card name.
 *   Hours    — `formatDuration` (e.g. "2H 45M") to match the metrics card.
 *   Sum      — `value.toFixed(2) + " EUR"` to match the metrics card.
 *
 * No internal empty-state branch: `ReportsPage` routes empty datasets to the
 * shared `EmptyState` BEFORE the table mounts, so the table can assume
 * `byEntry.length > 0` at render time. Keeping the empty case out of here
 * avoids double-rendering an empty surface.
 *
 * S15 dropped the per-card aggregate layout this component used to render
 * (Card / Time / Rate / Earnings). The fresh i18n keys `reports.table.{date,
 * project,hours,sum}` replace the old `reports.table.{card,time,rate,earnings}`
 * + `reports.rate.{hourly,fixed}` set.
 */

interface ReportsTableProps {
  byEntry: ReportByEntry[];
}

export function ReportsTable({ byEntry }: ReportsTableProps) {
  const { t } = useTranslation();

  return (
    <div
      className="border-border bg-card overflow-x-auto rounded-md border"
      data-testid="reports-table"
    >
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-muted-foreground text-left">
            <th className="px-3 py-2 font-medium">{t('reports.table.date')}</th>
            <th className="px-3 py-2 font-medium">{t('reports.table.project')}</th>
            <th className="px-3 py-2 font-medium">{t('reports.table.hours')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('reports.table.sum')}</th>
          </tr>
        </thead>
        <tbody>
          {byEntry.map(({ entry, card, earnings }) => (
            <tr key={entry.id} className="border-border border-t">
              <td className="whitespace-nowrap px-3 py-2">
                {format(parseISO(entry.date), 'dd.MM.yyyy')}
              </td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    data-testid="reports-table-card-chip"
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: card.color }}
                  />
                  {card.name}
                </span>
              </td>
              {/* S16b decision (locked): Hours column shows `formatDuration` only —
                  NOT a "10:00–14:00 (4h)" time range. Rationale: time-of-day is
                  already visible on EntryChip surfaces (Calendar Month/Week/Day),
                  so duplicating it here would bloat the row without adding info.
                  Keep this comment so the next reviewer doesn't re-litigate. */}
              <td className="whitespace-nowrap px-3 py-2">{formatDuration(entry.durationMin)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right">{earnings.toFixed(2)} EUR</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
