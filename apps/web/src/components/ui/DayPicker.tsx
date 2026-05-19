import {
  addDays,
  addMonths,
  endOfMonth,
  format,
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
 * DayPicker — popover with a month stepper + a 6×7 grid of days.
 *
 * Replaces the native `<input type="date">` for the `day` preset on the
 * Reports filter bar so the day/week/month modes share one visual shell
 * (same Button-outline trigger, same popover, same hover/selected styling).
 *
 *   - `value`     : `YYYY-MM-DD` of the currently selected day.
 *   - `onChange`  : emits the new `YYYY-MM-DD` for the clicked cell.
 *
 * Locale-aware month label and weekday headers (Mon..Sun). Trigger label
 * uses the project's `dd.MM.yyyy` numeric format so it stays locale-stable.
 */
export interface DayPickerProps {
  /** YYYY-MM-DD anchor. */
  value: string;
  /** Emits `YYYY-MM-DD` for the picked day. */
  onChange: (anchor: string) => void;
  className?: string;
  'aria-label'?: string;
}

interface DayCell {
  date: Date;
  key: string;
  dayOfMonth: number;
  inBrowseMonth: boolean;
}

function buildGrid(browseMonth: Date): DayCell[] {
  const monthStart = startOfMonth(browseMonth);
  const monthEnd = endOfMonth(browseMonth);
  const firstMonday = startOfWeekMonday(monthStart);
  // 6 weeks × 7 days covers every possible month layout.
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = addDays(firstMonday, i);
    cells.push({
      date,
      key: formatLocalDate(date),
      dayOfMonth: date.getDate(),
      inBrowseMonth: date >= monthStart && date <= monthEnd,
    });
  }
  return cells;
}

export function DayPicker({
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: DayPickerProps) {
  const { t, i18n } = useTranslation();
  const locale = localeFor(i18n.resolvedLanguage ?? i18n.language);

  const valueDate = useMemo(() => parseISO(value), [value]);
  const [browseMonth, setBrowseMonth] = useState<Date>(startOfMonth(valueDate));
  const [open, setOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (next) setBrowseMonth(startOfMonth(valueDate));
    setOpen(next);
  };

  const triggerLabel = useMemo(() => format(valueDate, 'dd.MM.yyyy'), [valueDate]);

  const browseMonthLabel = useMemo(() => {
    const formatted = format(browseMonth, 'LLLL yyyy', { locale });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }, [browseMonth, locale]);

  const weekdayLabels = useMemo(() => {
    // Mon..Sun headers in the active locale.
    const monday = startOfWeekMonday(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i);
      const short = format(d, 'EEEEEE', { locale });
      return short.charAt(0).toUpperCase() + short.slice(1);
    });
  }, [locale]);

  const cells = useMemo(() => buildGrid(browseMonth), [browseMonth]);

  const pickDay = (cell: DayCell) => {
    onChange(cell.key);
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
          data-testid="day-picker-trigger"
          className={cn('min-w-[10rem] justify-start gap-2', className)}
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
            data-testid="day-picker-month-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium" data-testid="day-picker-month-label">
            {browseMonthLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setBrowseMonth((m) => addMonths(m, 1))}
            aria-label={t('calendar.next')}
            data-testid="day-picker-month-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {/* Weekday headers */}
        <div className="text-muted-foreground mb-1 grid grid-cols-7 text-center text-[11px] uppercase tracking-wide">
          {weekdayLabels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1" role="grid">
          {cells.map((cell) => {
            const isSelected = isSameDay(cell.date, valueDate);
            return (
              <button
                key={cell.key}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                data-testid={`day-picker-cell-${cell.key}`}
                onClick={() => pickDay(cell)}
                className={cn(
                  'focus-visible:ring-ring rounded-md border px-1 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2',
                  isSelected
                    ? 'border-foreground bg-secondary text-secondary-foreground font-medium'
                    : cell.inBrowseMonth
                      ? 'border-border hover:bg-accent hover:text-accent-foreground bg-background'
                      : 'border-transparent text-muted-foreground hover:bg-accent/50 bg-background',
                )}
              >
                {cell.dayOfMonth}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
