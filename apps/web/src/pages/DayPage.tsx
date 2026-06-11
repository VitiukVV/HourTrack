import { useMemo, useState } from 'react';
import { format, parseISO, addDays } from 'date-fns';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import type { Card, Entry } from '@hourtrack/shared-types';
import {
  earningsForEntry,
  formatDuration,
  formatLocalDate,
  monthlyEarningsPerEntry,
} from '@hourtrack/shared-utils';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { useAllCardsQuery } from '@/features/cards/useCards';
import { DayPickerModal } from '@/features/entries/DayPickerModal';
import { EntryEditor } from '@/features/entries/EntryEditor';
import { useCreateEntryMutation, useEntriesByDateQuery } from '@/features/entries/useEntries';
import { useEntriesInRange } from '@/features/calendar/useEntriesInRange';
import { localeFor } from '@/features/calendar/calendarLocale';
import { db, getEntriesByCardId } from '@/lib/db';
import { formatDate } from '@/lib/date';
import { useQuery } from '@tanstack/react-query';

/**
 * DayPage — `/day/:date` route.
 *
 * Validates the `:date` route param matches `YYYY-MM-DD`; invalid params
 * redirect to `/` (Home). Renders the full list of entries for the date
 * (no truncation), a localized weekday + DD.MM.YYYY title, prev/next-day
 * navigation, and an "+ Add entry" button that opens the DayPickerModal.
 *
 * Earnings preview inside each `EntryEditor` needs the FULL per-card entry
 * set in scope (for fixed-rate proportional split). We load it via a per-card
 * `getEntriesByCardId` query keyed by `['entries', 'by-card', cardId]`. This
 * is fetched once for each distinct card on the day; small enough that it's
 * cheaper than restructuring `useEntriesInRange` to widen its window.
 */

const DATE_PARAM_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * S13 task #9: virtualization threshold. Below this entry count the plain
 * render path stays — Virtuoso adds non-trivial JS + a windowed scrolling
 * container that hurts UX for small days. Above the threshold the
 * windowed list keeps the DOM size bounded regardless of how many
 * entries the user logged. 20 was empirically the inflection point where
 * unvirtualized renders started feeling sluggish on mid-tier mobile
 * devices.
 */
const VIRTUALIZE_THRESHOLD = 20 as const;

function isValidDateParam(date: string | undefined): date is string {
  if (!date) return false;
  if (!DATE_PARAM_REGEX.test(date)) return false;
  // Defensive: reject impossible dates like 2026-02-31. parseISO returns
  // Invalid Date which round-trips through formatLocalDate to a different
  // value than what we got.
  const parsed = parseISO(date);
  if (Number.isNaN(parsed.getTime())) return false;
  return formatLocalDate(parsed) === date;
}

/**
 * TanStack Query hook that loads ALL entries for the given card across the
 * full DB. Used by `DayPage` to give `EntryEditor` the per-card entry set
 * required by fixed-rate earnings split.
 */
function useEntriesByCardQuery(cardId: string | undefined) {
  return useQuery<Entry[]>({
    queryKey: ['entries', 'by-card', cardId ?? null],
    queryFn: () => (cardId ? getEntriesByCardId(db, cardId) : Promise.resolve([])),
    enabled: !!cardId,
  });
}

interface DayPageBodyProps {
  date: string;
}

function DayPageBody({ date }: DayPageBodyProps) {
  const { t, i18n } = useTranslation();
  const dateObj = useMemo(() => parseISO(date), [date]);

  const prevDate = useMemo(() => formatLocalDate(addDays(dateObj, -1)), [dateObj]);
  const nextDate = useMemo(() => formatLocalDate(addDays(dateObj, 1)), [dateObj]);

  const lang = i18n.resolvedLanguage ?? i18n.language;
  const locale = localeFor(lang);
  const weekday = useMemo(() => {
    const raw = format(dateObj, 'EEEE', { locale });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [dateObj, locale]);

  const dayEntriesQuery = useEntriesByDateQuery(date);
  // S07 followup: use `useAllCardsQuery(true)` (active + archived) instead of
  // `useCardsQuery` (active only) as the canonical source. Entries that
  // reference an archived card now resolve directly to that card record
  // regardless of whether the calendar-range query has loaded the same set
  // — previously orphan-card display was fragile for dates outside the
  // current grid range.
  const allCardsQuery = useAllCardsQuery(true);
  const createEntry = useCreateEntryMutation();

  // We also need the entries-in-range bucket so each EntryEditor row can
  // resolve its card metadata + (for fixed-rate cards) the proportional
  // split's per-card set. We compute the SAME range as the month grid would
  // for this anchor — keeps the cache shared.
  const rangeQuery = useEntriesInRange({ mode: 'month', anchorDate: date });
  const cardsById = useMemo(() => {
    const map = new Map<string, Card>();
    for (const c of allCardsQuery.data ?? []) {
      map.set(c.id, c);
    }
    // Defensive: also fill in cards that the range query's cardsById knows
    // about. With `useAllCardsQuery(true)` this should be a no-op in
    // practice; we keep it as belt-and-braces for entries whose card may
    // have been deleted between the range query and now.
    if (rangeQuery.data) {
      for (const [id, c] of rangeQuery.data.cardsById) {
        if (!map.has(id)) map.set(id, c);
      }
    }
    return map;
  }, [allCardsQuery.data, rangeQuery.data]);

  const entries = dayEntriesQuery.data ?? [];

  // For fixed-rate split we need the FULL per-card entry list (not just
  // current-range). Build a map keyed by cardId. Each distinct card on the
  // day spawns one `useEntriesByCardQuery` — but hooks can't run in loops,
  // so we accept the day's <=20 entries and load them on demand from the
  // already-warm range cache as a best-effort. For cards whose entries
  // extend beyond the current range, fall back to entries in scope: this is
  // documented as a known approximation for v1 (Reports in S07 carries the
  // full-period scope when filters drive the calculation).
  const entriesByCardInScope = useMemo(() => {
    if (!rangeQuery.data) return new Map<string, Entry[]>();
    return rangeQuery.data.entriesByCard;
  }, [rangeQuery.data]);

  const [pickerOpen, setPickerOpen] = useState(false);

  const handlePick = (card: Card) => {
    void createEntry.mutateAsync({
      id: crypto.randomUUID(),
      cardId: card.id,
      date,
      // S16: copy the card's default start-of-day onto the new entry so the
      // v2 Entry schema is satisfied. S16b mounts a per-entry override.
      startMinutes: card.defaultStartMinutes,
      durationMin: card.defaultDurationMin,
      useCustomPayment: false,
      customPayment: null,
      note: card.defaultNote ?? null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
    });
  };

  const totalMin = entries.reduce((sum, e) => sum + e.durationMin, 0);
  const totalEarnings = entries.reduce((sum, e) => {
    const card = cardsById.get(e.cardId);
    if (!card) return sum;
    const bucket = entriesByCardInScope.get(e.cardId) ?? [e];
    // Monthly non-custom entries earn their per-entry share of the retainer
    // (monthlyTotal / count of the card's non-custom entries that month).
    // `earningsForEntry` returns 0 for them, which made the day total read
    // "0.00 EUR" while each EntryEditor row above it showed its share — the
    // two now agree. `bucket` is the month-scope range (DayPage fetches
    // `mode: 'month'`), so the denominator covers the entry's full month.
    if (card.rateType === 'monthly' && !e.useCustomPayment) {
      return sum + monthlyEarningsPerEntry(e, card, bucket);
    }
    return sum + earningsForEntry(e, card, bucket);
  }, 0);

  return (
    <section data-testid="day-page" className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">{t('dayPage.back')}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/day/${prevDate}`}>{t('dayPage.previousDay')}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/day/${nextDate}`}>{t('dayPage.nextDay')}</Link>
          </Button>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('dayPage.title', { weekday, date: formatDate(date) })}
        </h1>
      </header>

      {dayEntriesQuery.isLoading ? (
        // Don't flash the "no entries" EmptyState (with its Add-entry CTA)
        // while the day's entries are still loading — on every prev/next-day
        // navigation that produced a misleading empty state + layout shift.
        <div
          data-testid="day-page-loading"
          className="text-muted-foreground p-6 text-center text-sm"
        >
          {t('common.loading')}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          testId="day-page-empty"
          title={t('empty.noEntriesTitle')}
          body={t('empty.noEntriesBody')}
          cta={
            <Button type="button" size="sm" onClick={() => setPickerOpen(true)}>
              {t('empty.noEntriesCta')}
            </Button>
          }
        />
      ) : entries.length > VIRTUALIZE_THRESHOLD ? (
        // S13 task #9: virtualize long lists. Threshold-based switch keeps
        // small days using the plain render path (cheaper, no library
        // overhead) and only opts into Virtuoso when the list would
        // actually choke mid-tier devices. Container height matches the
        // visible viewport area minus the day-page header + total row.
        <div data-testid="day-page-entries-virtualized" style={{ height: 'min(70vh, 800px)' }}>
          <Virtuoso
            data={entries}
            itemContent={(_index, entry) => (
              <div className="pb-3">
                <DayPageEntryRow
                  entry={entry}
                  card={cardsById.get(entry.cardId)}
                  fallbackBucket={entriesByCardInScope.get(entry.cardId) ?? [entry]}
                />
              </div>
            )}
            computeItemKey={(_, entry) => entry.id}
          />
        </div>
      ) : (
        <div data-testid="day-page-entries-list" className="flex flex-col gap-3">
          {entries.map((entry) => (
            <DayPageEntryRow
              key={entry.id}
              entry={entry}
              card={cardsById.get(entry.cardId)}
              fallbackBucket={entriesByCardInScope.get(entry.cardId) ?? [entry]}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" onClick={() => setPickerOpen(true)}>
          {t('dayPage.addEntry')}
        </Button>
        {entries.length > 0 && (
          <div data-testid="day-page-total" className="text-sm">
            <span className="text-muted-foreground">{t('dayPage.dayTotal')}: </span>
            <span className="font-medium">{formatDuration(totalMin)}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="font-medium">{totalEarnings.toFixed(2)} EUR</span>
          </div>
        )}
      </div>

      {pickerOpen && (
        <DayPickerModal
          open
          date={date}
          onOpenChange={setPickerOpen}
          onPick={(card) => {
            handlePick(card);
            setPickerOpen(false);
          }}
        />
      )}
    </section>
  );
}

interface DayPageEntryRowProps {
  entry: Entry;
  card: Card | undefined;
  /**
   * Fallback bucket from the calendar-range query. Used only while the more
   * accurate `getEntriesByCardId` query is still loading.
   */
  fallbackBucket: Entry[];
}

/**
 * Bridges the calendar-range cache and the full per-card entry list. We
 * prefer the latter when present (fixed-rate split needs the FULL period),
 * but fall back to the range bucket on first render so the UI never shows
 * "0.00 EUR" for a beat.
 */
function DayPageEntryRow({ entry, card, fallbackBucket }: DayPageEntryRowProps) {
  const fullSetQuery = useEntriesByCardQuery(card?.id);
  const allCardEntries = fullSetQuery.data ?? fallbackBucket;
  return <EntryEditor entry={entry} card={card} allCardEntries={allCardEntries} />;
}

export function DayPage() {
  const { date } = useParams<{ date: string }>();
  if (!isValidDateParam(date)) {
    return <Navigate to="/" replace />;
  }
  return <DayPageBody date={date} />;
}
