import { memo } from 'react';
import { StickyNote } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Card, Entry } from '@hourtrack/shared-types';

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
  /**
   * Saturday or Sunday — used by MonthView to apply a subtle bg tint so the
   * week rhythm reads at a glance (the same agenda-style affordance ported
   * to the grid layout). Falsy / unset is treated as a regular weekday and
   * preserves the legacy look.
   */
  isWeekend?: boolean;
  /** Click handler — S05 dispatches dayClickAction here. */
  onClick?: (date: string) => void;
  /**
   * S17 — chip-click handler. When provided, each entry chip in the cell
   * becomes a button that fires this callback with the entry id (and stops
   * propagation so the day-click handler above doesn't fire). MonthView
   * supplies the per-view modal-state setter as this callback.
   */
  onEntryEdit?: (entryId: string) => void;
}

/**
 * One cell of the month grid. Renders:
 *   - Day number badge (today is visually emphasized).
 *   - Every entry as a colored full-width chip — no cap, no `+N more`.
 *   - Note marker in the top-right corner when any entry has `note != null`.
 *
 * S21 (UR-21-2): the per-day footer ("total hours · total earnings") was
 * REMOVED. The `entriesByCard` prop is retained on the public interface for
 * backwards compatibility but is unused inside the cell.
 *
 * S23 — wrapped in `React.memo` with an explicit comparator (see
 * `dayCellPropsEqual` below) so MonthView re-renders triggered by a single
 * entry change skip every untouched cell. The comparator is reference-only
 * by design: `entries`, `cardsById`, `entriesByCard` are stable Maps /
 * arrays produced by `useEntriesInRange`, and after S23 Part C's surgical
 * range-cache patches, untouched buckets keep their array identity across
 * mutations. If a future change starts allocating those buckets fresh on
 * every render (e.g. inline `.filter()` in the parent), the memo becomes a
 * no-op — fix that, don't deepen the comparator.
 */
function DayCellImpl({
  date,
  dayNumber,
  entries,
  cardsById,
  // S21 (UR-21-2): entriesByCard is preserved on the public props shape
  // (consumers still pass it) but is no longer consumed inside the cell.
  // The per-day duration/earnings footer was removed, so the proportional-
  // split math went with it.
  entriesByCard: _entriesByCard,
  isToday,
  isCurrentMonth,
  isWeekend = false,
  onClick,
  onEntryEdit,
}: DayCellProps) {
  const { t } = useTranslation();
  // All entries render — the per-breakpoint cap and the `+N more` overflow
  // popover were removed. Day cells grow vertically to fit every entry.
  const hasNote = entries.some((e) => e.note != null);

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
      data-weekend={isWeekend ? 'true' : 'false'}
      className={cn(
        // Each cell paints its own surface; the grid gap (parent
        // `bg-foreground/20 gap-1` in MonthView) shows through as the
        // separator. Mobile cell height grows naturally; sm:+ keeps the
        // legacy 7rem minimum so the desktop grid feels familiar.
        'bg-background relative flex min-h-20 flex-col gap-0.5 p-1 text-left transition-shadow sm:min-h-[7rem] sm:gap-1 sm:p-1.5',
        // Weekend rhythm (Sat/Sun): subtle muted bg shift so the eye reads
        // the seven-day cycle at a glance — same trick as the agenda view.
        // Skipped for today/out-of-month days so those signals don't fight.
        isWeekend && isCurrentMonth && !isToday && 'bg-muted/40',
        // Out-of-month days: faded surface + reduced opacity (unchanged).
        !isCurrentMonth && 'bg-muted/30 opacity-60',
        // Today: primary-tinted surface + inset ring + a subtle elevation
        // cue so the current day reads as the focal cell on a glance.
        isToday && 'bg-primary/5 ring-primary shadow-sm ring-2 ring-inset',
        // Hover: light accent + small drop shadow for tactile interactivity.
        onClick && 'hover:bg-accent/40 cursor-pointer transition-colors hover:shadow-sm',
      )}
    >
      <div className="flex items-start justify-between">
        <span
          className={cn(
            // Bumped from text-xs → text-sm and added `tabular-nums` so the
            // day number reads as the primary anchor of the cell, matching
            // the agenda view's date-column emphasis.
            'text-sm font-semibold tabular-nums leading-none',
            isToday
              ? 'bg-primary text-primary-foreground inline-flex h-6 w-6 items-center justify-center rounded-full shadow-sm'
              : isCurrentMonth
                ? 'text-foreground/80'
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

      {/* Stacked entry chips form a single contiguous block of card colors —
          no inner gap, so a day with multiple entries reads as one banded
          column of work rather than disconnected pill fragments. */}
      <div className="flex flex-1 flex-col gap-px">
        {entries.map((entry) => (
          <EntryChip
            key={entry.id}
            entry={entry}
            card={cardsById.get(entry.cardId)}
            onEdit={onEntryEdit}
          />
        ))}
      </div>

      {/* S21 (UR-21-2): the per-day total-hours/earnings footer was removed
          deliberately. If a future sprint reintroduces it, it's a NEW
          feature — do not treat as a revert. */}
    </div>
  );
}

/**
 * Explicit comparator for `memo(DayCell)`. Reference-equality on every prop
 * is sufficient because:
 *
 *   - `entries`         — array produced by `useEntriesInRange.entriesByDate.get(date)`.
 *                          With S23 Part C's surgical patches, untouched
 *                          dates keep their bucket reference across entry
 *                          mutations.
 *   - `cardsById`       — Map produced fresh per `useEntriesInRange` query.
 *                          Stable until a cards mutation triggers a refetch.
 *   - `entriesByCard`   — same shape; stable across entry mutations except
 *                          on the touched card(s).
 *   - `isToday`/`isCurrentMonth`/`isWeekend` — primitive booleans.
 *   - `date`/`dayNumber` — primitive string/number, change only on the
 *                          parent's anchor-date change (which forces a new
 *                          range query anyway).
 *   - `onClick`/`onEntryEdit` — stabilised at the parent via `useCallback`
 *                          (see MonthView/WeekView/WeekAgendaView).
 *
 * If a future contributor adds a new prop, this comparator MUST be updated.
 * The `keyof DayCellProps`-based assertion `assertEveryPropChecked` (see
 * `DayCell.test.tsx`) catches forgotten props at type-check time so the
 * memo doesn't silently drop a real prop and ship stale renders.
 */
function dayCellPropsEqual(prev: DayCellProps, next: DayCellProps): boolean {
  return (
    prev.date === next.date &&
    prev.dayNumber === next.dayNumber &&
    prev.entries === next.entries &&
    prev.cardsById === next.cardsById &&
    prev.entriesByCard === next.entriesByCard &&
    prev.isToday === next.isToday &&
    prev.isCurrentMonth === next.isCurrentMonth &&
    prev.isWeekend === next.isWeekend &&
    prev.onClick === next.onClick &&
    prev.onEntryEdit === next.onEntryEdit
  );
}

export const DayCell = memo(DayCellImpl, dayCellPropsEqual);
