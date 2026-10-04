import { parseISO } from 'date-fns';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import type { Card, Entry } from '@hourtrack/shared-types';
import { formatDuration, formatLocalDate } from '@hourtrack/shared-utils';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { DayPickerModal } from '@/features/entries/DayPickerModal';
import { EntryEditor } from '@/features/entries/EntryEditor';
import { useEntriesByCardQuery } from '@/features/entries/useEntries';
import { formatDate } from '@/lib/utils/date';

import { useDayPageController } from './useDayPageController';

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
 * `useEntriesByCardQuery` live read, once for each distinct card on the day;
 * small enough that it's cheaper than restructuring `useEntriesInRange` to
 * widen its window.
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

interface DayPageBodyProps {
  date: string;
}

function DayPageBody({ date }: DayPageBodyProps) {
  const { t } = useTranslation();
  const {
    prevDate,
    nextDate,
    weekday,
    dayEntriesQuery,
    cardsById,
    entries,
    entriesByCardInScope,
    pickerOpen,
    setPickerOpen,
    handlePick,
    totalMin,
    totalEarnings,
  } = useDayPageController(date);

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

      {dayEntriesQuery.isError ? (
        // A failed Dexie read must not render as "no entries" — that reads as
        // data loss on a local-first tracker.
        <div
          data-testid="day-page-error"
          role="alert"
          className="text-destructive p-6 text-center text-sm"
        >
          {t('common.loadFailed')}
        </div>
      ) : dayEntriesQuery.isLoading ? (
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
   * accurate `useEntriesByCardQuery` read is still loading.
   */
  fallbackBucket: Entry[];
}

/**
 * Bridges the calendar-range read and the full per-card entry list. We
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
