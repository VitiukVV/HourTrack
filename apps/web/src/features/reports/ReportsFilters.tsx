import { addDays, addMonths, addWeeks, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatLocalDate } from '@hourtrack/shared-utils';

import { useAllCardsQuery } from '@/features/cards/useCards';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';

import { useReportsFilters, type ReportsPeriod } from './reportsStore';

/**
 * Sticky filter bar at the top of /reports. Composes:
 *   - Period preset buttons (Day / Week / Month / Custom)
 *   - Date or range picker (single date for day/week/month; two dates for
 *     custom)
 *   - Card multi-select chips
 *   - "Show archived" toggle (adds archived cards to the multi-select pool)
 *   - Reset button
 *
 * All state lives in `useReportsFilters` (Zustand + sessionStorage). This
 * component is a thin presentation layer over that store + the cards query.
 */

const PERIODS: { id: ReportsPeriod; labelKey: string }[] = [
  { id: 'day', labelKey: 'reports.period.day' },
  { id: 'week', labelKey: 'reports.period.week' },
  { id: 'month', labelKey: 'reports.period.month' },
  { id: 'custom', labelKey: 'reports.period.custom' },
];

export function ReportsFilters() {
  const { t } = useTranslation();
  const {
    period,
    anchorDate,
    customStart,
    customEnd,
    selectedCardIds,
    showArchived,
    setPeriod,
    setAnchorDate,
    setCustomRange,
    toggleCardId,
    setShowArchived,
    reset,
  } = useReportsFilters();

  const cardsQuery = useAllCardsQuery(showArchived);
  const cards = useMemo(() => cardsQuery.data ?? [], [cardsQuery.data]);

  // Effective selection — `null` means "all cards currently in the pool".
  const effectiveSelected = useMemo(() => {
    if (selectedCardIds === null) return new Set(cards.map((c) => c.id));
    return new Set(selectedCardIds);
  }, [selectedCardIds, cards]);

  const handleAnchorPrev = () => {
    const d = parseISO(anchorDate);
    if (period === 'day') setAnchorDate(formatLocalDate(addDays(d, -1)));
    else if (period === 'week') setAnchorDate(formatLocalDate(addWeeks(d, -1)));
    else setAnchorDate(formatLocalDate(addMonths(d, -1)));
  };
  const handleAnchorNext = () => {
    const d = parseISO(anchorDate);
    if (period === 'day') setAnchorDate(formatLocalDate(addDays(d, 1)));
    else if (period === 'week') setAnchorDate(formatLocalDate(addWeeks(d, 1)));
    else setAnchorDate(formatLocalDate(addMonths(d, 1)));
  };

  return (
    <div
      data-testid="reports-filters"
      className="bg-background sticky top-0 z-10 flex flex-col gap-3 border-b py-3"
    >
      {/* Row 1: period presets + Reset */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('reports.period.day')}>
          {PERIODS.map((p) => {
            const isActive = period === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  'focus-visible:ring-ring inline-flex items-center rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2',
                  isActive
                    ? 'border-foreground bg-secondary text-secondary-foreground font-medium'
                    : 'border-border hover:bg-accent hover:text-accent-foreground bg-background',
                )}
              >
                {t(p.labelKey)}
              </button>
            );
          })}
        </div>
        <div className="ml-auto">
          <Button type="button" variant="outline" size="sm" onClick={reset}>
            {t('reports.filters.reset')}
          </Button>
        </div>
      </div>

      {/* Row 2: date / range picker */}
      <div className="flex flex-wrap items-center gap-2">
        {period === 'custom' ? (
          <>
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs" htmlFor="reports-custom-start">
                {t('reports.period.day')} 1
              </label>
              <Input
                id="reports-custom-start"
                type="date"
                value={customStart ?? ''}
                onChange={(e) => {
                  const start = e.target.value;
                  const end = customEnd ?? start;
                  setCustomRange(start, end);
                }}
                className="w-44"
              />
            </div>
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs" htmlFor="reports-custom-end">
                {t('reports.period.day')} 2
              </label>
              <Input
                id="reports-custom-end"
                type="date"
                value={customEnd ?? ''}
                onChange={(e) => {
                  const end = e.target.value;
                  const start = customStart ?? end;
                  setCustomRange(start, end);
                }}
                className="w-44"
              />
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleAnchorPrev}
              aria-label={t('calendar.previous')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
              className="w-44"
              aria-label={t('reports.period.day')}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleAnchorNext}
              aria-label={t('calendar.next')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-muted-foreground ml-2 text-xs" data-testid="anchor-readable">
              {formatDate(anchorDate)}
            </span>
          </div>
        )}
      </div>

      {/* Row 3: card multi-select + show archived */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">{t('reports.filters.cards')}:</span>
        {cards.length === 0 ? (
          <span className="text-muted-foreground text-xs italic">{t('reports.empty.body')}</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {cards.map((card) => {
              const isSelected = effectiveSelected.has(card.id);
              return (
                <button
                  key={card.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() =>
                    toggleCardId(
                      card.id,
                      cards.map((c) => c.id),
                    )
                  }
                  className={cn(
                    'focus-visible:ring-ring inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2',
                    isSelected
                      ? 'border-foreground bg-secondary text-secondary-foreground'
                      : 'border-border bg-background opacity-60 hover:opacity-100',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: card.color }}
                  />
                  {card.name}
                </button>
              );
            })}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Switch
            id="reports-show-archived"
            checked={showArchived}
            onCheckedChange={(v) => setShowArchived(v)}
          />
          <label htmlFor="reports-show-archived" className="text-sm">
            {t('reports.filters.showArchived')}
          </label>
        </div>
      </div>
    </div>
  );
}
