import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { StickyNote } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Card, Entry } from '@hourtrack/shared-types';

import { cn } from '@/lib/utils';
import { useMediaQuery, MEDIA_QUERIES } from '@/lib/hooks/useMediaQuery';

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
  /**
   * S17 — chip-click handler. When provided, each entry chip in the cell
   * becomes a button that fires this callback with the entry id (and stops
   * propagation so the day-click handler above doesn't fire). MonthView
   * supplies the per-view modal-state setter as this callback.
   */
  onEntryEdit?: (entryId: string) => void;
}

/**
 * Chip visibility caps per breakpoint.
 *
 *   - `< sm` (phones): SHOW ALL chips. Earlier the mobile cap was 2 to keep
 *     the cell ~64px tall, but the resulting `+N more` popover was the
 *     user's bigger complaint than a vertically-tall month view. We now let
 *     phone day-cells grow to fit every entry — the month surface becomes
 *     vertically scrollable for entry-heavy months, which is the expected
 *     mobile UX.
 *   - `sm:+` (small tablets, default desktop): 3 chips. Tablet+ cells still
 *     have the legacy width × 7rem cap, so the overflow popover stays as a
 *     density control there.
 */
const MAX_VISIBLE_CHIPS_BELOW_SM = Infinity;
const MAX_VISIBLE_CHIPS_SM_AND_UP = 3;

/**
 * One cell of the month grid. Renders:
 *   - Day number badge (today is visually emphasized).
 *   - Up to 3 colored entry chips; `+N more` link to `/day/:date` if more.
 *   - Note marker in the top-right corner when any entry has `note != null`.
 *
 * S21 (UR-21-2): the per-day footer ("total hours · total earnings") was
 * REMOVED. MonthView cells now read as: day-number + entry-chips + optional
 * note marker. That's it. The `entriesByCard` prop is retained on the public
 * interface for backwards compatibility (DayCell consumers still pass it)
 * but it is currently unused inside the cell — earnings aggregation has
 * moved entirely to Reports.
 */
export function DayCell({
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
  onClick,
  onEntryEdit,
}: DayCellProps) {
  const { t } = useTranslation();
  const isBelowSm = useMediaQuery(MEDIA_QUERIES.belowSm);
  const maxVisibleChips = isBelowSm ? MAX_VISIBLE_CHIPS_BELOW_SM : MAX_VISIBLE_CHIPS_SM_AND_UP;
  const visibleEntries = entries.slice(0, maxVisibleChips);
  const overflowCount = Math.max(0, entries.length - maxVisibleChips);
  const hasNote = entries.some((e) => e.note != null);

  // S18 — `+N more` popover state. Mobile gets an inline expandable list
  // (taps on hidden entries route through the same `onEntryEdit` callback
  // so the edit modal opens directly without leaving the calendar surface).
  const [overflowOpen, setOverflowOpen] = useState(false);
  const reactId = useId();
  const overflowPanelId = `daycell-overflow-${reactId}`;
  const overflowRef = useRef<HTMLDivElement | null>(null);

  // Close the popover when the user taps outside of it. The wrapper cell's
  // click handler would otherwise also fire (creating a "tap to close +
  // re-fire day click" feel); the popover swallows clicks via the same
  // `stopPropagation` discipline as EntryChip.
  useEffect(() => {
    if (!overflowOpen) return undefined;
    const onDocClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [overflowOpen]);

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
        // Borders moved to the parent grid via `gap-px bg-border`. Each
        // cell paints its own `bg-background` so the grid gap shows
        // through as the separator. Mobile cell height grows naturally
        // (no fixed cap) so all chips fit; sm:+ keeps the legacy 7rem
        // minimum so the desktop month grid stays familiar.
        'bg-background relative flex min-h-20 flex-col gap-0.5 p-1 text-left sm:min-h-[7rem] sm:gap-1 sm:p-1.5',
        !isCurrentMonth && 'bg-muted/30 opacity-60',
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

      <div className="flex flex-1 flex-col gap-0.5">
        {visibleEntries.map((entry) => (
          <EntryChip
            key={entry.id}
            entry={entry}
            card={cardsById.get(entry.cardId)}
            onEdit={onEntryEdit}
          />
        ))}
        {overflowCount > 0 && (
          <div className="relative" ref={overflowRef}>
            <button
              type="button"
              data-testid={`day-cell-${date}-overflow-toggle`}
              aria-haspopup="dialog"
              aria-expanded={overflowOpen}
              aria-controls={overflowPanelId}
              onClick={(e) => {
                // Stop propagation so opening the popover doesn't also fire
                // the day-click handler on the parent cell.
                e.stopPropagation();
                setOverflowOpen((o) => !o);
              }}
              className="text-muted-foreground hover:text-foreground w-full text-left text-[10px] underline-offset-2 hover:underline"
            >
              {t('calendar.plusNMore', { count: overflowCount })}
            </button>

            {overflowOpen && (
              <div
                id={overflowPanelId}
                role="dialog"
                aria-label={t('calendar.plusNMore', { count: overflowCount })}
                data-testid={`day-cell-${date}-overflow-panel`}
                onClick={(e) => e.stopPropagation()}
                className="border-border bg-popover absolute left-0 right-0 top-full z-20 mt-1 flex flex-col gap-1 rounded-md border p-1.5 shadow-md"
              >
                {entries.map((entry) => (
                  <EntryChip
                    key={entry.id}
                    entry={entry}
                    card={cardsById.get(entry.cardId)}
                    onEdit={(id) => {
                      setOverflowOpen(false);
                      onEntryEdit?.(id);
                    }}
                  />
                ))}
                <Link
                  to={`/day/${date}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-muted-foreground hover:text-foreground mt-1 text-center text-[10px] underline"
                >
                  {t('pages.day')}
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* S21 (UR-21-2): the per-day total-hours/earnings footer was removed
          deliberately. If a future sprint reintroduces it, it's a NEW
          feature — do not treat as a revert. */}
    </div>
  );
}
