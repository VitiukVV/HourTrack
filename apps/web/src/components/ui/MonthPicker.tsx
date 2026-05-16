import { format, getMonth, getYear, parseISO, setMonth, setYear, startOfMonth } from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatLocalDate } from '@hourtrack/shared-utils';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { localeFor } from '@/features/calendar/calendarLocale';
import { cn } from '@/lib/utils';

/**
 * MonthPicker — popover with a year stepper + 3×4 grid of months.
 *
 * Replaces the native `<input type="date">` for the `month` preset on the
 * Reports filter bar (S20 UR-20-5). Users picking "Month" want to pick a
 * MONTH, not a day-of-month — the native input forces them to drill into a
 * calendar to find any valid date in the desired month, which is the wrong
 * affordance.
 *
 *   - `value`     : `YYYY-MM-DD` (the 1st of the displayed month is what
 *                   leaves via `onChange`; if a non-1st date is passed in,
 *                   the picker still resolves it to its containing month for
 *                   the grid highlight and label).
 *   - `onChange`  : called with `YYYY-MM-01` for the clicked month.
 *
 * The trigger renders the localized month label (e.g. "May 2026" / "Травень
 * 2026" / "mayo 2026"). The popover is uncontrolled — `Popover.Root` manages
 * open state internally, and clicking a cell closes it via `onSelect`.
 */
export interface MonthPickerProps {
  /** YYYY-MM-DD anchor. The picker uses the month containing this date. */
  value: string;
  /** Emits `YYYY-MM-01` for the picked month. */
  onChange: (anchor: string) => void;
  className?: string;
  /** Optional aria-label override for the trigger. Falls back to month label. */
  'aria-label'?: string;
}

export function MonthPicker({
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: MonthPickerProps) {
  const { i18n } = useTranslation();
  const locale = localeFor(i18n.resolvedLanguage ?? i18n.language);

  const valueDate = useMemo(() => parseISO(value), [value]);
  const valueMonth = getMonth(valueDate);
  const valueYear = getYear(valueDate);

  // The grid's visible year is independent of the `value`'s year — the user
  // may want to browse 2025 or 2027 without committing. Seeds from `value`
  // but is local to this component.
  const [browseYear, setBrowseYear] = useState<number>(valueYear);
  const [open, setOpen] = useState(false);

  // When opened, snap browseYear back to the value's year so the grid
  // doesn't sit on a stale browse target from a previous open.
  const handleOpenChange = (next: boolean) => {
    if (next) setBrowseYear(valueYear);
    setOpen(next);
  };

  const monthLabel = useMemo(() => {
    const formatted = format(valueDate, 'LLLL yyyy', { locale });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }, [valueDate, locale]);

  // 12 short-month labels for the picked browse year. We render `LLL` (short
  // standalone month) which date-fns localizes to e.g. "Jan/Feb/.." (en),
  // "січ/лют/.." (uk), "ene/feb/.." (es).
  const monthLabels = useMemo(() => {
    const labels: string[] = [];
    for (let m = 0; m < 12; m += 1) {
      const refDate = setMonth(setYear(new Date(), browseYear), m);
      const short = format(refDate, 'LLL', { locale });
      labels.push(short.charAt(0).toUpperCase() + short.slice(1));
    }
    return labels;
  }, [browseYear, locale]);

  const pickMonth = (monthIdx: number) => {
    const picked = startOfMonth(setMonth(setYear(new Date(), browseYear), monthIdx));
    onChange(formatLocalDate(picked));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={ariaLabel ?? monthLabel}
          data-testid="month-picker-trigger"
          className={cn('min-w-[10rem] justify-start gap-2', className)}
        >
          <Calendar className="h-4 w-4 opacity-70" />
          <span className="truncate">{monthLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        {/* Year stepper */}
        <div className="mb-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setBrowseYear((y) => y - 1)}
            aria-label="Previous year"
            data-testid="month-picker-year-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium" data-testid="month-picker-year-label">
            {browseYear}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setBrowseYear((y) => y + 1)}
            aria-label="Next year"
            data-testid="month-picker-year-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {/* 3 × 4 grid */}
        <div className="grid grid-cols-3 gap-1" role="grid">
          {monthLabels.map((label, idx) => {
            const isSelected = idx === valueMonth && browseYear === valueYear;
            return (
              <button
                key={idx}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                data-testid={`month-picker-cell-${idx}`}
                onClick={() => pickMonth(idx)}
                className={cn(
                  'focus-visible:ring-ring rounded-md border px-2 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2',
                  isSelected
                    ? 'border-foreground bg-secondary text-secondary-foreground font-medium'
                    : 'border-border hover:bg-accent hover:text-accent-foreground bg-background',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
