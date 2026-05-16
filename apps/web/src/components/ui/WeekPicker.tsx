import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  getISOWeek,
  isSameDay,
  parseISO,
  startOfMonth,
} from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatLocalDate, startOfWeekMonday } from '@hourtrack/shared-utils';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { localeFor } from '@/features/calendar/calendarLocale';
import { cn } from '@/lib/utils';

/**
 * WeekPicker — popover with a month stepper + a vertical list of the weeks
 * (Mon-anchored) that overlap the browsed month.
 *
 * Replaces the native `<input type="date">` for the `week` preset on the
 * Reports filter bar (S20 UR-20-6). Users picking "Week" want to pick a
 * WEEK, not a date inside one. The native input forces them to remember
 * which day is the Monday — wrong affordance.
 *
 * Locked: weeks start Monday (`startOfWeekMonday` from `@hourtrack/shared-
 * utils`, the project-wide convention). The trigger label format is
 * `Week N · DD.MM–DD.MM.YYYY` regardless of locale (numbers + the project's
 * `dd.MM.yyyy` date format).
 *
 *   - `value`     : `YYYY-MM-DD` — any day inside the displayed week. The
 *                   picker resolves it to its Monday for the highlight.
 *   - `onChange`  : called with `YYYY-MM-DD` for the picked Monday.
 */
export interface WeekPickerProps {
  /** YYYY-MM-DD anchor. The picker uses the Mon..Sun week containing this date. */
  value: string;
  /** Emits the picked week's Monday as `YYYY-MM-DD`. */
  onChange: (mondayAnchor: string) => void;
  className?: string;
  'aria-label'?: string;
}

interface WeekRow {
  /** Monday of the week (a `Date`). */
  monday: Date;
  /** ISO week number for display (1..53). */
  isoWeek: number;
  /** YYYY-MM-DD Monday for the click handler. */
  mondayKey: string;
  /** Pre-formatted range `DD.MM–DD.MM.YYYY`. */
  rangeLabel: string;
}

/** Build the weeks that overlap a given month (start Mon, end Sun). */
function buildWeeksForMonth(month: Date): WeekRow[] {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const firstMonday = startOfWeekMonday(monthStart);
  const rows: WeekRow[] = [];
  let cursor = firstMonday;
  // Guard against runaways — a month spans at most 6 weeks. The loop exits
  // once Monday is past month-end.
  for (let i = 0; i < 6; i += 1) {
    if (cursor > monthEnd) break;
    const sunday = addDays(cursor, 6);
    rows.push({
      monday: cursor,
      isoWeek: getISOWeek(cursor),
      mondayKey: formatLocalDate(cursor),
      rangeLabel: `${format(cursor, 'dd.MM')}–${format(sunday, 'dd.MM.yyyy')}`,
    });
    cursor = addDays(cursor, 7);
  }
  return rows;
}

export function WeekPicker({
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: WeekPickerProps) {
  const { t, i18n } = useTranslation();
  const locale = localeFor(i18n.resolvedLanguage ?? i18n.language);

  const valueDate = useMemo(() => parseISO(value), [value]);
  const valueMonday = useMemo(() => startOfWeekMonday(valueDate), [valueDate]);
  const valueISOWeek = useMemo(() => getISOWeek(valueMonday), [valueMonday]);
  const valueRange = useMemo(() => {
    const sunday = addDays(valueMonday, 6);
    return `${format(valueMonday, 'dd.MM')}–${format(sunday, 'dd.MM.yyyy')}`;
  }, [valueMonday]);

  // Browse month seeded from the value. Locale-controlled "May 2026" label.
  const [browseMonth, setBrowseMonth] = useState<Date>(startOfMonth(valueDate));
  const [open, setOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (next) setBrowseMonth(startOfMonth(valueDate));
    setOpen(next);
  };

  const browseMonthLabel = useMemo(() => {
    const formatted = format(browseMonth, 'LLLL yyyy', { locale });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }, [browseMonth, locale]);

  const rows = useMemo(() => buildWeeksForMonth(browseMonth), [browseMonth]);

  const triggerLabel = `${t('calendar.week')} ${valueISOWeek} · ${valueRange}`;

  const pickWeek = (row: WeekRow) => {
    onChange(row.mondayKey);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={ariaLabel ?? triggerLabel}
          data-testid="week-picker-trigger"
          className={cn('min-w-[14rem] justify-start gap-2', className)}
        >
          <Calendar className="h-4 w-4 opacity-70" />
          <span className="truncate">{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        {/* Month stepper */}
        <div className="mb-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setBrowseMonth((m) => addMonths(m, -1))}
            aria-label={t('calendar.previous')}
            data-testid="week-picker-month-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium" data-testid="week-picker-month-label">
            {browseMonthLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setBrowseMonth((m) => addMonths(m, 1))}
            aria-label={t('calendar.next')}
            data-testid="week-picker-month-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {/* Weeks list */}
        <ul className="flex flex-col gap-1" data-testid="week-picker-weeks">
          {rows.map((row) => {
            const isSelected = isSameDay(row.monday, valueMonday);
            return (
              <li key={row.mondayKey}>
                <button
                  type="button"
                  aria-selected={isSelected}
                  data-testid={`week-picker-cell-${row.mondayKey}`}
                  onClick={() => pickWeek(row)}
                  className={cn(
                    'focus-visible:ring-ring flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2',
                    isSelected
                      ? 'border-foreground bg-secondary text-secondary-foreground font-medium'
                      : 'border-border hover:bg-accent hover:text-accent-foreground bg-background',
                  )}
                >
                  <span className="text-muted-foreground text-xs">
                    {t('calendar.week')} {row.isoWeek}
                  </span>
                  <span>{row.rangeLabel}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
