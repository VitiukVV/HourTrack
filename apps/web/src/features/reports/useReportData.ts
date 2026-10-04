import { parseISO } from 'date-fns';
import { useMemo } from 'react';

import {
  endOfMonth,
  endOfWeekSunday,
  formatLocalDate,
  startOfMonth,
  startOfWeekMonday,
} from '@hourtrack/shared-utils';

import { db, getCardsOrdered, getEntriesByDateRange } from '@/lib/db';
import { useLiveRead, type LiveRead } from '@/lib/db/useLiveRead';
import { useAllCardsQuery } from '@/features/cards/useCards';

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

export function useReportData(): LiveRead<ReportDataResult> {
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

  // S23 Task 24 — memoize selectedKey so the same `selectedCardIds` array
  // reference doesn't reallocate the sorted-and-joined string on every
  // render. selectedCardIds is itself a stable Zustand selector result;
  // we still defensively sort + join only when it changes.
  const selectedKey = useMemo(
    () => (selectedCardIds === null ? 'all' : selectedCardIds.slice().sort().join(',')),
    [selectedCardIds],
  );

  // S23 Task 23 — conditional month-scope. Monthly-retainer cards need the
  // full calendar months that overlap the period for their per-entry
  // denominator (the share each visible entry shows is `monthlyTotal /
  // count of all that card's non-custom entries in the month` — see
  // `monthlyEarningsPerEntry`). For every other rate type, widening the
  // entries query to the surrounding full months is wasted work — the
  // query reads extra Dexie rows that `computeReport` immediately filters
  // back out.
  //
  // Read the (active+archived) cards via the existing hook so the widening
  // decision is reactive: when the user creates or archives a monthly card
  // mid-session, the read re-keys and the scope flips correctly.
  //
  // The widening boolean MUST be part of the read key: the key is what
  // restarts the query, and the scope it reads depends on it.
  const cardsQuery = useAllCardsQuery(true);
  const hasMonthlyCard = useMemo(
    () => (cardsQuery.data ?? []).some((c) => c.rateType === 'monthly' && c.monthlyTotal != null),
    [cardsQuery.data],
  );

  const { scopeStart, scopeEnd } = useMemo(() => {
    if (!hasMonthlyCard) {
      return { scopeStart: start, scopeEnd: end };
    }
    return {
      scopeStart: formatLocalDate(startOfMonth(parseISO(start))),
      scopeEnd: formatLocalDate(endOfMonth(parseISO(end))),
    };
  }, [hasMonthlyCard, start, end]);

  return useLiveRead(
    `reports:${start}..${end}:${showArchived}:${selectedKey}:${hasMonthlyCard}`,
    async (): Promise<ReportDataResult> => {
      const [entries, cards] = await Promise.all([
        getEntriesByDateRange(db, scopeStart, scopeEnd),
        getCardsOrdered(db, showArchived),
      ]);

      const effectiveSelected = selectedCardIds === null ? cards.map((c) => c.id) : selectedCardIds;

      const report = computeReport(entries, cards, effectiveSelected, start, end);
      return { ...report, start, end, cards };
    },
    cardsQuery.isSuccess,
  );
}
