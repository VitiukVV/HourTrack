import { useMemo, useState } from 'react';
import { format, parseISO, addDays } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Card, Entry } from '@hourtrack/shared-types';
import {
  earningsForEntry,
  formatLocalDate,
  monthlyEarningsPerEntry,
} from '@hourtrack/shared-utils';

import { useAllCardsQuery } from '@/features/cards/useCards';
import { useCreateEntryMutation, useEntriesByDateQuery } from '@/features/entries/useEntries';
import { useEntriesInRange } from '@/features/entries/useEntriesInRange';
import { localeFor } from '@/lib/i18n/calendarLocale';

/**
 * Spec 008 — the state and behaviour behind the DayPage body: prev/next and
 * weekday labels, the day / month-range / card reads, the day totals, and the
 * "+ Add entry" picker → create flow. The page keeps only the markup.
 */
export function useDayPageController(date: string) {
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
  // for this anchor.
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
  // range read as a best-effort. For cards whose entries
  // extend beyond the current range, fall back to entries in scope: this is
  // documented as a known approximation for v1 (Reports in S07 carries the
  // full-period scope when filters drive the calculation).
  const entriesByCardInScope = useMemo(() => {
    if (!rangeQuery.data) return new Map<string, Entry[]>();
    return rangeQuery.data.entriesByCard;
  }, [rangeQuery.data]);

  const [pickerOpen, setPickerOpen] = useState(false);

  const handlePick = (card: Card) => {
    // `.mutate` with an onError toast, not a fire-and-forget `mutateAsync`:
    // a failed Dexie write used to leave the tap a silent no-op. Mirrors
    // useDayClickFlow's handling on the calendar surface.
    createEntry.mutate(
      {
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
      },
      {
        onError: (err) => {
          console.error('[DayPage] createEntry failed:', err);
          toast.error(t('entries.saveFailed'));
        },
      },
    );
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

  return {
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
  };
}
