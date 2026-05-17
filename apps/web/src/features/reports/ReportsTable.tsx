import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { formatDuration } from '@hourtrack/shared-utils';

import { getReadableTextColor } from '@/lib/colors';

import type { ReportByEntry } from './computeReport';

/**
 * Flat entry-row table for /reports. One `<tr>` per filtered entry; columns:
 *
 *   Date     — `dd.MM.yyyy` (the project's existing display format, also used
 *              by the calendar grids and the bar-chart x-axis pre-S15).
 *   Project  — color chip + card name.
 *   Hours    — `formatDuration` (e.g. "2h 45m") to match the metrics card.
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
 *
 * Sticky-Date z-index — `z-[5]` (read this before bumping it).
 *   The sticky cells only need to sit ABOVE their non-positioned row
 *   siblings (z-auto) so they stay legible during horizontal scroll. They
 *   MUST stay BELOW:
 *     - the ReportsFilters sticky bar (`z-10`) — otherwise the Date cells
 *       render on top of the filter bar's bottom border on vertical scroll;
 *     - the chrome header (`sticky top-0 z-20`) — vertically-scrolling Date
 *       cells must pass behind it, not over it (mobile bug report);
 *     - any popover/picker portaled at `z-50`.
 *   A previous revision used `z-20` here ("S20 Task 6 fix" for UR-20-3) on
 *   the theory that the row's date anchor should sit above the filter bar's
 *   bottom border. That theory was wrong: the chrome header (also `z-20`,
 *   earlier in DOM) loses to the Date cell on equal z-index → Date cells
 *   bleed over the top header on mobile. Keep this at `z-[5]`.
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
      {/* S18 — `border-collapse: separate; border-spacing: 0` is required
          for sticky table cells (the default `collapse` mode strips the
          cell's own background, so the sticky cell becomes transparent on
          scroll). The first column (Date) is sticky on `< md` so the user
          always sees the row's anchor while scrolling Project/Hours/Sum
          horizontally. On `md:+` the table fits the viewport and the
          stickiness is suppressed (no horizontal scroll → no need). */}
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="bg-muted/40">
          <tr className="text-muted-foreground text-left">
            <th
              data-testid="reports-table-th-date"
              className="border-border bg-muted/40 sticky left-0 z-[5] border-b px-3 py-2 font-medium md:static md:bg-transparent"
            >
              {t('reports.table.date')}
            </th>
            <th className="border-border border-b px-3 py-2 font-medium">
              {t('reports.table.project')}
            </th>
            <th className="border-border border-b px-3 py-2 font-medium">
              {t('reports.table.hours')}
            </th>
            <th className="border-border border-b px-3 py-2 text-right font-medium">
              {t('reports.table.sum')}
            </th>
          </tr>
        </thead>
        <tbody>
          {byEntry.map(({ entry, card, earnings }) => (
            <tr key={entry.id}>
              <td
                data-testid="reports-table-td-date"
                className="border-border bg-card sticky left-0 z-[5] whitespace-nowrap border-t px-3 py-2 md:static"
              >
                {format(parseISO(entry.date), 'dd.MM.yyyy')}
              </td>
              {/* Project pill — fixed-width so every row's chip reads as
                  the same shape regardless of card-name length. Long names
                  truncate with ellipsis; `title={card.name}` reveals the
                  full name on hover. Mirrors the CardChip carousel pattern
                  in the chrome (same-width pills). */}
              <td className="border-border border-t px-3 py-2">
                <span
                  data-testid="reports-table-card-chip"
                  style={{
                    backgroundColor: card.color,
                    color: getReadableTextColor(card.color),
                  }}
                  className="inline-flex w-32 items-center justify-center truncate rounded-full px-2.5 py-0.5 text-xs font-medium"
                  title={card.name}
                >
                  {card.name}
                </span>
              </td>
              {/* S16b decision (locked): Hours column shows `formatDuration` only —
                  NOT a "10:00–14:00 (4h)" time range. Rationale: time-of-day is
                  already visible on EntryChip surfaces (Calendar Month/Week/Day),
                  so duplicating it here would bloat the row without adding info.
                  Keep this comment so the next reviewer doesn't re-litigate. */}
              <td className="border-border whitespace-nowrap border-t px-3 py-2">
                {formatDuration(entry.durationMin)}
              </td>
              {/* S21 — Monthly-rate cards render '—' in the Sum column. The
                  retainer is billed at PERIOD scope (not per entry), so a
                  per-row currency value would be misleading. The grand
                  total (in ReportsMetrics) DOES include the retainer via
                  `computeReport.monthlyContribution`. */}
              <td
                data-testid="reports-table-td-sum"
                className="border-border whitespace-nowrap border-t px-3 py-2 text-right"
              >
                {card.rateType === 'monthly' ? '—' : `${earnings.toFixed(2)} EUR`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
