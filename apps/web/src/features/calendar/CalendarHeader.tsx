import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';

import { useCalendarView } from './calendarStore';
import { formatMonthYear } from './calendarLocale';
import { rangeFor } from './useEntriesInRange';

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
  const { t, i18n } = useTranslation();
  const mode = useCalendarView((s) => s.mode);
  const anchorDate = useCalendarView((s) => s.anchorDate);
  const setMode = useCalendarView((s) => s.setMode);
  const prev = useCalendarView((s) => s.prev);
  const next = useCalendarView((s) => s.next);
  const goToday = useCalendarView((s) => s.goToday);

  const title =
    mode === 'month'
      ? formatMonthYear(anchorDate, i18n.resolvedLanguage ?? i18n.language)
      : weekRangeTitle(anchorDate);

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

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('calendar.previous')}
            onClick={() => prev()}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span
            data-testid="calendar-title"
            // S18 — narrower on mobile (`min-w-[6rem]` ≈ 96px) so the
            // header doesn't overflow at 375px. Falls back to 8rem on `sm:+`.
            className="min-w-[6rem] text-center text-xs font-medium sm:min-w-[8rem] sm:text-sm"
          >
            {title}
          </span>
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

/** "11.05 – 17.05" for the week containing `anchorDate`. */
function weekRangeTitle(anchorDate: string): string {
  const { start, end } = rangeFor('week', anchorDate);
  // formatDate consumes DD.MM.YYYY; we strip the year suffix for the short form.
  const fmt = (iso: string) => formatDate(iso).slice(0, 5);
  return `${fmt(start)} – ${fmt(end)}`;
}
