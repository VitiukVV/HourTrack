import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { MonthPicker } from '@/components/ui/MonthPicker';
import { WeekPicker } from '@/components/ui/WeekPicker';
import { cn } from '@/lib/utils';

import { useCalendarView } from './calendarStore';

/**
 * Top strip of the calendar surface. Hosts the [Month | Week] view toggle,
 * the localized title (month + year in month mode, `DD.MM – DD.MM` range in
 * week mode), and the Previous / Today / Next nav controls wired straight
 * through to `useCalendarView`.
 *
 * Accessibility: each icon button carries an accessible name via
 * `aria-label` so screen-reader users hear `Previous` / `Next` / `Today`
 * rather than the empty SVG glyphs.
 */
export function CalendarHeader() {
  const { t } = useTranslation();
  // S23 Task 26 — `mode` and `anchorDate` are reactive state; subscribe.
  // The four actions (`setMode`, `setAnchor`, `prev`, `next`, `goToday`)
  // are immutable references in the Zustand store (defined inside
  // `create(...)` and never reassigned). Subscribe to them ONCE outside
  // the React reactive layer via `getState()`; this collapses five
  // store subscriptions into a single `useState` initializer and skips
  // four selector evaluations on every store change.
  const mode = useCalendarView((s) => s.mode);
  const anchorDate = useCalendarView((s) => s.anchorDate);
  const { setMode, setAnchor, prev, next, goToday } = useCalendarView.getState();

  return (
    <div
      data-testid="calendar-header"
      className="border-border bg-background sticky top-[6.25rem] z-10 border-b"
    >
      {/* S18 — on `< sm` the header packs into 2 rows (toggle + nav stack
          vertically) so a 375px viewport never wraps in awkward shapes.
          On `sm:+` the legacy single-row layout returns. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-2 py-2 sm:px-4">
        <div className="inline-flex items-center rounded-md border" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'month'}
            onClick={() => setMode('month')}
            className={cn(
              // S18 — `min-h-[44px]` on mobile for the toggle buttons.
              'min-h-[44px] rounded-l-md px-3 py-1.5 text-sm transition-colors sm:min-h-0',
              mode === 'month'
                ? 'bg-secondary text-secondary-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('calendar.month')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'week'}
            onClick={() => setMode('week')}
            className={cn(
              'min-h-[44px] rounded-r-md px-3 py-1.5 text-sm transition-colors sm:min-h-0',
              mode === 'week'
                ? 'bg-secondary text-secondary-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('calendar.week')}
          </button>
        </div>

        <div data-testid="calendar-title" className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('calendar.previous')}
            onClick={() => prev()}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          {/* The picker's trigger button replaces the old static title.
              Choosing a date via the picker writes a fresh anchor through
              `setAnchor`. The trigger's accessible name already says
              "May 2026" / "Week 20 · 11.05 – 17.05" so the header retains
              its at-a-glance role. */}
          {mode === 'month' ? (
            <MonthPicker
              value={anchorDate}
              onChange={setAnchor}
              className="min-w-[8rem] sm:min-w-[10rem]"
            />
          ) : (
            <WeekPicker
              value={anchorDate}
              onChange={setAnchor}
              className="min-w-[10rem] sm:min-w-[14rem]"
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('calendar.next')}
            onClick={() => next()}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goToday()}
            aria-label={t('calendar.today')}
          >
            {t('calendar.today')}
          </Button>
        </div>
      </div>
    </div>
  );
}
