import { parseISO } from 'date-fns';
import { useMemo, useRef } from 'react';

import type { Card, CalendarView, Entry } from '@hourtrack/shared-types';
import {
  endOfMonth,
  endOfWeekSunday,
  formatLocalDate,
  startOfMonth,
  startOfWeekMonday,
} from '@hourtrack/shared-utils';

import { db, getAllCards, getEntriesByDateRange } from '@/lib/db';
import { useLiveRead, type LiveRead } from '@/lib/db/useLiveRead';

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
 * The read is live (spec 006): any write to entries or cards — an edit, a sync
 * pull, a Calendar stamp — re-runs it. Each re-run keeps the previous bucket
 * arrays and `cardsById` map wherever their contents did not change, so
 * `memo(DayCell)` (S23) still re-renders only the days a write touched.
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

/** Same rows, field for field — Dexie hands back fresh objects on every read. */
function sameRow<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

function sameRows<T extends object>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((row, i) => sameRow(row, b[i]!));
}

/** `next` with every bucket whose rows did not change swapped for `prev`'s array. */
function shareBuckets<T extends object>(
  prev: Map<string, T[]> | undefined,
  next: Map<string, T[]>,
): Map<string, T[]> {
  if (!prev) return next;
  const out = new Map<string, T[]>();
  for (const [key, bucket] of next) {
    const old = prev.get(key);
    out.set(key, old && sameRows(old, bucket) ? old : bucket);
  }
  return out;
}

function shareCards(
  prev: Map<string, Card> | undefined,
  next: Map<string, Card>,
): Map<string, Card> {
  if (!prev || prev.size !== next.size) return next;
  for (const [id, card] of next) {
    const old = prev.get(id);
    if (!old || !sameRow(old, card)) return next;
  }
  return prev;
}

function pushToBucket(buckets: Map<string, Entry[]>, key: string, entry: Entry): void {
  const bucket = buckets.get(key);
  if (bucket) {
    bucket.push(entry);
  } else {
    buckets.set(key, [entry]);
  }
}

async function readRange(start: string, end: string): Promise<EntriesInRangeData> {
  const [entries, cards] = await Promise.all([
    getEntriesByDateRange(db, start, end),
    // Include archived so chips on already-archived cards still render.
    getAllCards(db, true),
  ]);

  const entriesByDate = new Map<string, Entry[]>();
  const entriesByCard = new Map<string, Entry[]>();
  for (const entry of entries) {
    pushToBucket(entriesByDate, entry.date, entry);
    pushToBucket(entriesByCard, entry.cardId, entry);
  }

  const cardsById = new Map<string, Card>();
  for (const card of cards) {
    cardsById.set(card.id, card);
  }

  return { start, end, entries, entriesByDate, entriesByCard, cardsById };
}

export function useEntriesInRange(args: EntriesInRangeArgs): LiveRead<EntriesInRangeData> {
  const { mode, anchorDate } = args;
  const { start, end } = useMemo(() => rangeFor(mode, anchorDate), [mode, anchorDate]);

  const live = useLiveRead(`entries:range:${start}..${end}`, () => readRange(start, end));

  const previous = useRef<EntriesInRangeData | undefined>(undefined);
  const data = useMemo(() => {
    const next = live.data;
    if (!next) return undefined;
    const prev =
      previous.current?.start === next.start && previous.current.end === next.end
        ? previous.current
        : undefined;
    return {
      ...next,
      entriesByDate: shareBuckets(prev?.entriesByDate, next.entriesByDate),
      entriesByCard: shareBuckets(prev?.entriesByCard, next.entriesByCard),
      cardsById: shareCards(prev?.cardsById, next.cardsById),
    };
  }, [live.data]);
  previous.current = data ?? previous.current;

  return { ...live, data };
}
