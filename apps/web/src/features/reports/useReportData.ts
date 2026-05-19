import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { useMemo } from 'react';

import {
  endOfMonth,
  endOfWeekSunday,
  formatLocalDate,
  startOfMonth,
  startOfWeekMonday,
} from '@hourtrack/shared-utils';

import { db, getAllCards, getEntriesByDateRange } from '@/lib/db';

import type { Card } from '@hourtrack/shared-types';

import { computeReport, type ReportData } from './computeReport';
import { useReportsFilters, type ReportsPeriod } from './reportsStore';

/**
 * Resolves the (start, end) YYYY-MM-DD pair for the current filter state.
 *
 *   - day    → single day on anchorDate.
 *   - week   → Mon..Sun bracketing anchorDate.
 *   - month  → 1st..last day of the calendar month containing anchorDate
 *              (NOT the calendar GRID — Reports want pure month boundaries).
 *   - custom → customStart..customEnd verbatim. Falls back to the current month
 *              if either bound is missing so the hook never produces an
 *              invalid range.
 */
export function rangeForReports(
  period: ReportsPeriod,
  anchorDate: string,
  customStart: string | null,
  customEnd: string | null,
): { start: string; end: string } {
  const anchor = parseISO(anchorDate);
  if (period === 'day') {
    return { start: anchorDate, end: anchorDate };
  }
  if (period === 'week') {
    return {
      start: formatLocalDate(startOfWeekMonday(anchor)),
      end: formatLocalDate(endOfWeekSunday(anchor)),
    };
  }
  if (period === 'month') {
    return {
      start: formatLocalDate(startOfMonth(anchor)),
      end: formatLocalDate(endOfMonth(anchor)),
    };
  }
  // custom
  if (customStart && customEnd) {
    // Defensive: if the user picks end < start, swap so the query is valid.
    if (customEnd < customStart) return { start: customEnd, end: customStart };
    return { start: customStart, end: customEnd };
  }
  // Fallback to current month
  return {
    start: formatLocalDate(startOfMonth(anchor)),
    end: formatLocalDate(endOfMonth(anchor)),
  };
}

export interface ReportDataResult extends ReportData {
  start: string;
  end: string;
  /** Cards in scope (active + archived if showArchived) — still needed by `ReportsFilters`. */
  cards: Card[];
}

export function useReportData(): UseQueryResult<ReportDataResult> {
  const period = useReportsFilters((s) => s.period);
  const anchorDate = useReportsFilters((s) => s.anchorDate);
  const customStart = useReportsFilters((s) => s.customStart);
  const customEnd = useReportsFilters((s) => s.customEnd);
  const selectedCardIds = useReportsFilters((s) => s.selectedCardIds);
  const showArchived = useReportsFilters((s) => s.showArchived);

  const { start, end } = useMemo(
    () => rangeForReports(period, anchorDate, customStart, customEnd),
    [period, anchorDate, customStart, customEnd],
  );

  // Cache key includes the filter inputs that affect the result so two views
  // with different filters don't collide. selectedCardIds is JSON-encoded
  // because TanStack Query keys must be primitives/arrays of primitives.
  const selectedKey = selectedCardIds === null ? 'all' : selectedCardIds.slice().sort().join(',');

  // Monthly-rate cards need the full calendar months that overlap the period
  // for their per-entry denominator (the share each visible entry shows is
  // monthlyTotal / count of all that card's non-custom entries in the month —
  // see `monthlyEarningsPerEntry`). So we widen the entries query to the
  // union of full months that touch [start, end]; computeReport then filters
  // back to [start, end] for the visible byEntry rows.
  const scopeStart = useMemo(() => formatLocalDate(startOfMonth(parseISO(start))), [start]);
  const scopeEnd = useMemo(() => formatLocalDate(endOfMonth(parseISO(end))), [end]);

  return useQuery({
    queryKey: ['entries', 'range', 'reports', start, end, showArchived, selectedKey] as const,
    queryFn: async (): Promise<ReportDataResult> => {
      const [entries, cards] = await Promise.all([
        getEntriesByDateRange(db, scopeStart, scopeEnd),
        getAllCards(db, showArchived),
      ]);

      // Expand the `null` "follow active cards" sentinel into the actual ID
      // list AT QUERY TIME — this is the load-bearing reason the store keeps
      // null instead of materializing IDs eagerly: it stays correct when
      // cards are created/archived without the user re-touching the filter.
      const effectiveSelected = selectedCardIds === null ? cards.map((c) => c.id) : selectedCardIds;

      // `entries` now spans the wider month scope (so monthly denominators
      // see every entry in the calendar month); computeReport filters back
      // to [start, end] for visible byEntry / byCard rows.
      const report = computeReport(entries, cards, effectiveSelected, start, end);
      return { ...report, start, end, cards };
    },
  });
}
