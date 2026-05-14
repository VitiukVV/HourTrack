import { Link } from 'react-router-dom';
import { StickyNote } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Card, Entry } from '@hourtrack/shared-types';
import { earningsForEntry, formatDuration } from '@hourtrack/shared-utils';

import { cn } from '@/lib/utils';

import { EntryChip } from './EntryChip';

interface DayCellProps {
  /** YYYY-MM-DD local date for this cell. */
  date: string;
  /** Display number — `1` … `31`. */
  dayNumber: number;
  /** Entries that fall on this day (sorted by `createdAt` ascending). */
  entries: Entry[];
  /** Cards lookup map (all cards including archived). */
  cardsById: Map<string, Card>;
  /** All entries in the visible range, used for fixed-rate proportional split. */
  allRangeEntries: Entry[];
  isToday: boolean;
  /** False for the leading/trailing fade-row days in MonthView. */
  isCurrentMonth: boolean;
  /** Optional click handler — S05 wires create/delete here. S04 stubs it to no-op. */
  onClick?: (date: string) => void;
}

/** Maximum chips shown in-cell before collapsing the overflow into `+N more`. */
const MAX_VISIBLE_CHIPS = 3;

/**
 * One cell of the month grid. Renders:
 *   - Day number badge (today is visually emphasized).
 *   - Up to 3 colored entry chips; `+N more` link to `/day/:date` if more.
 *   - Note marker in the top-right corner when any entry has `note != null`.
 *   - Footer: total duration (`{H}H {M}M`) + total earnings in EUR (2dp).
 *
 * For fixed-rate cards, the proportional split needs the FULL set of that
 * card's entries in scope — `earningsForEntry` walks the supplied list. We
 * pass `allRangeEntries` (everything visible in the current calendar grid) and
 * filter by `cardId` per chip. This is a reasonable scope for a calendar grid:
 * Reports (S07) will recompute with the per-card period scope as required by
 * its filters.
 */
export function DayCell({
  date,
  dayNumber,
  entries,
  cardsById,
  allRangeEntries,
  isToday,
  isCurrentMonth,
  onClick,
}: DayCellProps) {
  const { t } = useTranslation();
  const visibleEntries = entries.slice(0, MAX_VISIBLE_CHIPS);
  const overflowCount = Math.max(0, entries.length - MAX_VISIBLE_CHIPS);
  const hasNote = entries.some((e) => e.note != null);

  const totalMin = entries.reduce((sum, e) => sum + e.durationMin, 0);
  const totalEarnings = entries.reduce((sum, e) => {
    const card = cardsById.get(e.cardId);
    if (!card) return sum;
    const cardEntries = allRangeEntries.filter((x) => x.cardId === e.cardId);
    return sum + earningsForEntry(e, card, cardEntries);
  }, 0);

  const handleClick = () => onClick?.(date);

  return (
    <div
      data-testid={`day-cell-${date}`}
      data-today={isToday ? 'true' : 'false'}
      data-current-month={isCurrentMonth ? 'true' : 'false'}
      onClick={handleClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : -1}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className={cn(
        'border-border bg-background relative flex min-h-[7rem] flex-col gap-1 border-b border-r p-1.5 text-left',
        !isCurrentMonth && 'opacity-50',
        isToday && 'ring-primary ring-1 ring-inset',
        onClick && 'hover:bg-accent/40 cursor-pointer transition-colors',
      )}
    >
      <div className="flex items-start justify-between">
        <span
          className={cn(
            'text-xs font-medium',
            isToday
              ? 'bg-primary text-primary-foreground inline-flex h-5 w-5 items-center justify-center rounded-full'
              : 'text-muted-foreground',
          )}
        >
          {dayNumber}
        </span>
        {hasNote && (
          <StickyNote
            data-testid="note-marker"
            aria-label={t('calendar.hasNote')}
            className="text-muted-foreground h-3 w-3"
          />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        {visibleEntries.map((entry) => (
          <EntryChip key={entry.id} entry={entry} card={cardsById.get(entry.cardId)} />
        ))}
        {overflowCount > 0 && (
          <Link
            to={`/day/${date}`}
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground text-[10px] underline-offset-2 hover:underline"
          >
            {t('calendar.plusNMore', { count: overflowCount })}
          </Link>
        )}
      </div>

      {entries.length > 0 && (
        <div className="text-muted-foreground flex items-center justify-between text-[10px]">
          <span>{formatDuration(totalMin)}</span>
          <span>{totalEarnings.toFixed(2)} EUR</span>
        </div>
      )}
    </div>
  );
}
