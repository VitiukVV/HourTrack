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
  // mid-session, the query re-keys and the scope flips correctly.
  //
  // The widening boolean MUST be part of the query key. Without it, two
  // mounts with identical period bounds but different monthly-card
  // populations would collide on the same cache row.
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

  return useQuery({
    queryKey: [
      'entries',
      'range',
      'reports',
      start,
      end,
      showArchived,
      selectedKey,
      // S23 — including `hasMonthlyCard` in the key partitions caches so a
      // session that creates its first monthly card doesn't serve a stale
      // narrow-scoped result.
      hasMonthlyCard,
    ] as const,
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

      // When the scope was widened, `entries` spans the union of calendar
      // months touching [start, end] so monthly denominators see every
      // entry in those months. computeReport filters back to [start, end]
      // for the visible byEntry / byCard rows.
      const report = computeReport(entries, cards, effectiveSelected, start, end);
      return { ...report, start, end, cards };
    },
    // Don't kick off the query until the cards hook has resolved — without
    // this, the first render uses `hasMonthlyCard = false` (cards.data is
    // undefined), the query runs narrow-scoped, and then a second render
    // with the resolved cards rekeys the query and triggers a refetch. The
    // gate is cheap because cardsQuery is shared across the app's mount.
    enabled: cardsQuery.isSuccess,
  });
}
