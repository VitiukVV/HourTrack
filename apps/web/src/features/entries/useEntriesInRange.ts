import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { useMemo } from 'react';

import type { Card, CalendarView, Entry } from '@hourtrack/shared-types';
import {
  endOfMonth,
  endOfWeekSunday,
  formatLocalDate,
  startOfMonth,
  startOfWeekMonday,
} from '@hourtrack/shared-utils';

import { db, getAllCards, getEntriesByDateRange } from '@/lib/db';

/**
 * Hook that returns the entries + cards needed to render the calendar surface
 * for the current `{ mode, anchorDate }` pair.
 *
 * Range semantics:
 *   - `mode === 'month'`  → the FULL CALENDAR GRID range, i.e. Monday of the
 *     week containing the 1st through Sunday of the week containing the last
 *     day of the month. This guarantees entries on visible "outside-month"
 *     cells (e.g. April 27 in the May 2026 grid) still appear.
 *   - `mode === 'week'`   → Monday→Sunday of the week containing `anchorDate`.
 *
 * Returns four pieces:
 *   - `start`, `end`           — YYYY-MM-DD bounds of the query.
 *   - `entries`                — list, sorted by date asc (then createdAt asc).
 *   - `entriesByDate`          — `Map<YYYY-MM-DD, Entry[]>` for O(1) cell lookup.
 *   - `cardsById`              — `Map<cardId, Card>` for O(1) color/name lookup
 *                                inside chips. Includes archived cards so that
 *                                entries belonging to a recently-archived card
 *                                still render correctly.
 *
 * Query key convention (continues the S03 pattern):
 *   `['entries', 'range', start, end]`. The `cardsById` map shares the
 *   adjacent `['cards', 'all']` cache so writes from any cards mutation cascade
 *   correctly via the parent `['cards']` invalidation in S03's `useCards`.
 */

export interface EntriesInRangeArgs {
  mode: CalendarView;
  anchorDate: string; // YYYY-MM-DD
}

export interface EntriesInRangeData {
  start: string;
  end: string;
  entries: Entry[];
  entriesByDate: Map<string, Entry[]>;
  /**
   * `Map<cardId, Entry[]>` — addresses the S04 W2 follow-up so consumers
   * (DayCell totals, dayClick resolver) can find a card's entries in O(1)
   * instead of filtering `entries` per render.
   */
  entriesByCard: Map<string, Entry[]>;
  cardsById: Map<string, Card>;
}

/**
 * Compute the inclusive [start, end] YYYY-MM-DD range for the given mode and
 * anchor. Exported so HomePage can pre-compute it for navigation links.
 */
export function rangeFor(mode: CalendarView, anchorDate: string): { start: string; end: string } {
  const base = parseISO(anchorDate);
  if (mode === 'month') {
    // Bracket the month with full Mon→Sun weeks for the calendar grid.
    const monthStart = startOfMonth(base);
    const monthEnd = endOfMonth(base);
    return {
      start: formatLocalDate(startOfWeekMonday(monthStart)),
      end: formatLocalDate(endOfWeekSunday(monthEnd)),
    };
  }
  return {
    start: formatLocalDate(startOfWeekMonday(base)),
    end: formatLocalDate(endOfWeekSunday(base)),
  };
}

export function useEntriesInRange(args: EntriesInRangeArgs): UseQueryResult<EntriesInRangeData> {
  const { mode, anchorDate } = args;
  const { start, end } = useMemo(() => rangeFor(mode, anchorDate), [mode, anchorDate]);

  return useQuery({
    queryKey: ['entries', 'range', start, end],
    queryFn: async (): Promise<EntriesInRangeData> => {
      const [entries, cards] = await Promise.all([
        getEntriesByDateRange(db, start, end),
        // Include archived so chips on already-archived cards still render.
        getAllCards(db, true),
      ]);

      const entriesByDate = new Map<string, Entry[]>();
      const entriesByCard = new Map<string, Entry[]>();
      for (const entry of entries) {
        const dateBucket = entriesByDate.get(entry.date);
        if (dateBucket) {
          dateBucket.push(entry);
        } else {
          entriesByDate.set(entry.date, [entry]);
        }
        const cardBucket = entriesByCard.get(entry.cardId);
        if (cardBucket) {
          cardBucket.push(entry);
        } else {
          entriesByCard.set(entry.cardId, [entry]);
        }
      }

      const cardsById = new Map<string, Card>();
      for (const card of cards) {
        cardsById.set(card.id, card);
      }

      return { start, end, entries, entriesByDate, entriesByCard, cardsById };
    },
  });
}
