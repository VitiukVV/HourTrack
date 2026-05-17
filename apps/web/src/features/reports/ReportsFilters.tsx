import { addDays, addMonths, addWeeks, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatLocalDate } from '@hourtrack/shared-utils';

import { useAllCardsQuery } from '@/features/cards/useCards';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MonthPicker } from '@/components/ui/MonthPicker';
import { Switch } from '@/components/ui/switch';
import { WeekPicker } from '@/components/ui/WeekPicker';
import { getReadableTextColor } from '@/lib/colors';
import { cn } from '@/lib/utils';

import { useReportsFilters, type ReportsPeriod } from './reportsStore';

/**
 * Sticky filter bar at the top of /reports — split into TWO contiguous
 * sections (S20 UR-20-10 / Task 15):
 *
 *   Section 1 (`sticky top-0 z-10`)
 *     • Period preset buttons (Day / Week / Month / Custom) — single row,
 *       horizontally scrollable on narrow viewports (S20 UR-20-9 / Task 13).
 *     • Period-aware date/range picker:
 *         day    → native `<input type="date">` + prev/next arrows
 *         week   → WeekPicker             + prev/next arrows
 *         month  → MonthPicker            + prev/next arrows
 *         custom → two `<input type="date">`
 *       The duplicate readable-date span next to the arrows is gone (S20
 *       UR-20-4 / Task 8) — the picker's trigger label already conveys the
 *       selection in non-day modes; the native input renders its own
 *       readable date in day mode.
 *     • Reset button — destructive (red) variant, `ml-auto` (S20 UR-20-7 /
 *       Task 9).
 *
 *   Section 2 (NOT sticky — scrolls away with the page)
 *     • Card multi-select chips + a "Reset cards" button visible only when
 *       the selection is narrowed (S20 UR-20-8 / Task 11).
 *     • "Show archived" toggle.
 *
 * The split is the load-bearing UX change: on mobile, users want month +
 * table visible after they've decided which cards to look at. Pinning only
 * the period/picker/Reset honours that mental model.
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
    clearCardSelection,
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

  // "Reset cards" button is only meaningful when the user has narrowed the
  // selection. A null sentinel (= "all cards") doesn't need a reset
  // affordance.
  const showResetCards = selectedCardIds !== null && selectedCardIds.length > 0;

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
    <div data-testid="reports-filters">
      {/* Section 1 — sticky: period presets + picker + Reset.
          The chrome header is `sticky top-0 z-20`, so a `z-10` sticky here
          stacks BELOW the header when both are pinned. The ReportsTable's
          sticky Date cell is `z-[5]` — below this section so vertically
          scrolling Date cells pass BEHIND the filter bar, not over it. */}
      <div
        data-testid="reports-filters-section-sticky"
        className="bg-background sticky top-0 z-10 flex flex-col gap-3 border-b py-3"
      >
        {/* Row 1: period presets + Reset (single row, scrollable on narrow viewports) */}
        <div
          data-testid="reports-filters-presets-row"
          className="scrollbar-none flex flex-nowrap items-center gap-2 overflow-x-auto"
        >
          <div className="flex flex-nowrap gap-1" role="group" aria-label={t('reports.period.day')}>
            {PERIODS.map((p) => {
              const isActive = period === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setPeriod(p.id)}
                  className={cn(
                    'focus-visible:ring-ring inline-flex shrink-0 items-center whitespace-nowrap rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2',
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
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={reset}
            title={t('reports.filters.resetTooltip')}
            data-testid="reports-filters-reset"
            className="ml-auto shrink-0 gap-1"
          >
            <RotateCcw className="h-4 w-4" />
            {t('reports.filters.reset')}
          </Button>
        </div>

        {/* Row 2: date / range picker — branch on period */}
        <div className="flex flex-wrap items-center gap-2">
          {period === 'custom' ? (
            <>
              <div className="space-y-1">
                <label className="text-muted-foreground text-xs" htmlFor="reports-custom-start">
                  {t('reports.filters.from')}
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
                  {t('reports.filters.to')}
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
              {period === 'month' ? (
                // No aria-label override — let the picker's own label
                // (e.g. "May 2026") be the accessible name so the period
                // preset "Month" button stays uniquely identifiable for
                // tests + screen readers.
                <MonthPicker value={anchorDate} onChange={setAnchorDate} />
              ) : period === 'week' ? (
                <WeekPicker value={anchorDate} onChange={setAnchorDate} />
              ) : (
                <Input
                  type="date"
                  value={anchorDate}
                  onChange={(e) => setAnchorDate(e.target.value)}
                  className="w-44"
                  aria-label={t('reports.period.day')}
                />
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleAnchorNext}
                aria-label={t('calendar.next')}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              {/* S20 Task 8: the readable-date span that lived here is gone —
                  the picker trigger / native input already conveys the
                  selection, the duplicate was the UR-20-4 complaint. */}
            </div>
          )}
        </div>
      </div>

      {/* Section 2 — NOT sticky: card chip-row + reset-cards + show-archived.
          Scrolls away with the page so on mobile the user gets full vertical
          space for the table once they've decided which cards to view. */}
      <div
        data-testid="reports-filters-section-scrollable"
        className="flex flex-wrap items-center gap-2 py-3"
      >
        <span className="text-muted-foreground text-xs">{t('reports.filters.cards')}:</span>
        {cards.length === 0 ? (
          <span className="text-muted-foreground text-xs italic">{t('reports.empty.body')}</span>
        ) : (
          // S18 — on `< md` the card chips lay out as a horizontal
          // scrollable row (avoids the wrap-grid eating vertical space
          // on a 375px viewport). On `md:+` the legacy wrap-grid is
          // restored. `flex-nowrap overflow-x-auto md:flex-wrap` flips
          // the layout cleanly without two parallel render branches.
          // S20 — keep bg-color treatment from S19 even after the row
          // moved out of the sticky section.
          <div
            data-testid="reports-filters-card-chips"
            className="scrollbar-none -mx-2 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-2 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
          >
            {cards.map((card) => {
              const isSelected = effectiveSelected.has(card.id);
              const baseStyle = isSelected
                ? {
                    backgroundColor: card.color,
                    color: getReadableTextColor(card.color),
                  }
                : {
                    // `4D` = 30% alpha — same channel as the EntryChip bar
                    // variant's tinted background. The chip is still
                    // readable against the surrounding bg without claiming
                    // the "selected" affordance.
                    backgroundColor: `${card.color}4D`,
                  };
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
                  style={baseStyle}
                  title={card.name}
                  className={cn(
                    // S18 — bump tap height to 44px on `< md`; restore
                    // compact 28px on tablet+ where pointer precision is
                    // higher.
                    'focus-visible:ring-ring inline-flex min-h-[44px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 sm:min-h-0',
                    isSelected
                      ? 'border-foreground font-medium'
                      : 'text-foreground border-transparent opacity-80 hover:opacity-100',
                  )}
                >
                  {card.name}
                </button>
              );
            })}
          </div>
        )}
        {showResetCards && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearCardSelection}
            data-testid="reports-filters-reset-cards"
          >
            {t('reports.filters.resetCards')}
          </Button>
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
