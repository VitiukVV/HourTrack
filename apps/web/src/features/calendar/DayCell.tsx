import { memo } from 'react';
import { StickyNote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';

import type { Card, Entry } from '@hourtrack/shared-types';

import { formatDate } from '@/lib/date';
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
  /**
   * S25 — when true, each entry chip in the cell becomes a drag source AND
   * the cell becomes a droppable target (drop a chip here → reschedule the
   * entry to this `date`). Passed as a primitive so `memo(DayCell)` keeps its
   * bailout. `useDroppable` is called unconditionally (Rules of Hooks); only
   * the `isOver` highlight + the chips' `dragEnabled` spread are gated. The
   * `isOver` flag only flips for the hovered cell, so only that cell
   * re-renders during a drag — the S23 memo bailout holds for every other
   * cell.
   */
  dragEnabled?: boolean;
}

/**
 * One cell of the month grid. Renders:
 *   - Day number badge (today is visually emphasized).
 *   - Every entry as a colored full-width chip — no cap, no `+N more`.
 *   - Note marker in the top-right corner when any entry has `note != null`.
 *
 * S21 (UR-21-2): the per-day footer ("total hours · total earnings") was
 * REMOVED, and with it the `entriesByCard` prop the proportional-split math
 * needed — callers no longer pass it.
 *
 * S23 — wrapped in `React.memo` with the default shallow comparator. Every
 * prop is either a primitive or a reference-stable value from
 * `useEntriesInRange` / parent `useCallback`, so reference equality is what
 * we want. After S23 Part C's surgical range-cache patches, untouched
 * `entries` buckets keep their array identity across mutations — that's
 * what makes the bailout effective. If a future change starts allocating
 * those buckets fresh on every render (e.g. inline `.filter()` in the
 * parent), the memo becomes a no-op — fix the parent, don't switch to a
 * deep comparator here.
 */
function DayCellImpl({
  date,
  dayNumber,
  entries,
  cardsById,
  isToday,
  isCurrentMonth,
  isWeekend = false,
  onClick,
  onEntryEdit,
  dragEnabled = false,
}: DayCellProps) {
  const { t } = useTranslation();
  // All entries render — the per-breakpoint cap and the `+N more` overflow
  // popover were removed. Day cells grow vertically to fit every entry.
  const hasNote = entries.some((e) => e.note != null);

  // S25 — droppable target keyed by this cell's date. `useDroppable` is
  // called unconditionally; when drag is disabled the cell is still a
  // (never-hovered) droppable but `isOver` stays false, so the highlight and
  // the memo bailout are both unaffected.
  const { setNodeRef, isOver } = useDroppable({ id: date, disabled: !dragEnabled });

  const handleClick = () => onClick?.(date);

  // S04 W1 fix: do NOT set role="button" on the wrapper. Children (entry chips,
  // +N more link, future inline buttons) are interactive themselves, so a
  // button-role wrapper produces nested interactives in the a11y tree. The
  // cell is still keyboard-reachable via tabIndex + Enter/Space handler.
  return (
    <div
      ref={setNodeRef}
      data-testid={`day-cell-${date}`}
      data-today={isToday ? 'true' : 'false'}
      data-current-month={isCurrentMonth ? 'true' : 'false'}
      data-drop-over={isOver ? 'true' : 'false'}
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
      // Localized, human-readable name. The raw ISO `date` used to be the
      // accessible name, so a screen reader spelled out "2026-08-30" with no
      // hint of what pressing Enter here does.
      aria-label={onClick ? t('calendar.dayCellLabel', { date: formatDate(date) }) : undefined}
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
        // Out-of-month days: a muted surface carries the de-emphasis. NOT
        // `opacity-*` — that made the whole cell translucent, so MonthView's
        // `bg-foreground/20` grid showed through and the surface rendered
        // #d5d5d5 instead of near-white, while simultaneously washing the day
        // number out to #979797 (contrast 1.99, axe-core serious). With the
        // opacity gone the surface stays opaque and the number is readable.
        !isCurrentMonth && 'bg-muted/60',
        // Today: primary-tinted surface + inset ring + a subtle elevation
        // cue so the current day reads as the focal cell on a glance.
        isToday && 'bg-primary/5 ring-primary shadow-sm ring-2 ring-inset',
        // Hover: light accent + small drop shadow for tactile interactivity.
        onClick && 'hover:bg-accent/40 cursor-pointer transition-colors hover:shadow-sm',
        // S25 — drop-target highlight while a chip is dragged over this cell.
        // A strong primary ring + tint that reads on light/dark and over the
        // colored chip stack. Only the hovered cell gets `isOver`, so only it
        // re-renders (S23 memo bailout preserved for all others).
        isOver && 'ring-primary bg-primary/15 ring-2 ring-inset',
      )}
    >
      <div className="flex items-start justify-between">
        <span
          className={cn(
            // Bumped from text-xs → text-sm and added `tabular-nums` so the
            // day number reads as the primary anchor of the cell, matching
            // the agenda view's date-column emphasis.
            'text-sm leading-none font-semibold tabular-nums',
            isToday
              ? 'bg-primary text-primary-foreground inline-flex h-6 w-6 items-center justify-center rounded-full shadow-sm'
              : isCurrentMonth
                ? 'text-foreground/80'
                : // Out-of-month: still visibly secondary to the in-month
                  // `foreground/80`, but `text-muted-foreground` is too light
                  // to clear 4.5:1 at 14px on this surface.
                  'text-foreground/70',
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
      <div
        className={cn(
          'flex flex-1 flex-col gap-px',
          // Keep out-of-month entries visually secondary. This is where the
          // cell-wide `opacity-60` used to live; scoped to the chip stack it
          // no longer touches the day number (which has to clear 4.5:1) and
          // no longer makes the cell surface translucent.
          !isCurrentMonth && 'opacity-70',
        )}
      >
        {entries.map((entry) => (
          <EntryChip
            key={entry.id}
            entry={entry}
            card={cardsById.get(entry.cardId)}
            onEdit={onEntryEdit}
            dragEnabled={dragEnabled}
          />
        ))}
      </div>

      {/* S21 (UR-21-2): the per-day total-hours/earnings footer was removed
          deliberately. If a future sprint reintroduces it, it's a NEW
          feature — do not treat as a revert. */}
    </div>
  );
}

export const DayCell = memo(DayCellImpl);
