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
  /**
   * Per-card entry buckets across the full visible range. Used to compute
   * fixed-rate proportional split in O(1) per chip instead of an O(N) filter
   * over `allRangeEntries`. S04 W2 followup.
   */
  entriesByCard: Map<string, Entry[]>;
  isToday: boolean;
  /** False for the leading/trailing fade-row days in MonthView. */
  isCurrentMonth: boolean;
  /** Click handler — S05 dispatches dayClickAction here. */
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
  entriesByCard,
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
    // O(1) lookup via the entriesByCard map — replaces the O(N) filter that
    // S04's code-reviewer flagged (W2). For fixed-rate cards the proportional
    // split needs the FULL set of that card's visible entries.
    const cardEntries = entriesByCard.get(e.cardId) ?? [];
    return sum + earningsForEntry(e, card, cardEntries);
  }, 0);

  const handleClick = () => onClick?.(date);

  // S04 W1 fix: do NOT set role="button" on the wrapper. Children (entry chips,
  // +N more link, future inline buttons) are interactive themselves, so a
  // button-role wrapper produces nested interactives in the a11y tree. The
  // cell is still keyboard-reachable via tabIndex + Enter/Space handler.
  return (
    <div
      data-testid={`day-cell-${date}`}
      data-today={isToday ? 'true' : 'false'}
      data-current-month={isCurrentMonth ? 'true' : 'false'}
      {...(isToday ? { 'data-onboarding-anchor': 'today' } : {})}
      onClick={handleClick}
      tabIndex={onClick ? 0 : -1}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={onClick ? date : undefined}
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
