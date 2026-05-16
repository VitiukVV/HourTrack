import type { KeyboardEvent, MouseEvent } from 'react';
import { StickyNote } from 'lucide-react';

import type { Card, Entry } from '@hourtrack/shared-types';
import { formatDuration } from '@hourtrack/shared-utils';

import { minutesToHHMM } from '@/components/ui/TimeInput';
import { cn } from '@/lib/utils';

interface EntryChipProps {
  entry: Entry;
  card: Card | undefined;
  /**
   * Visual mode:
   *   - `bar`  (default, MonthView) — full-width thin pill, colored bar bg with
   *     low opacity + text overlay.
   *   - `row`  (WeekView)         — vertical-list row with color dot + name +
   *     duration + earnings + note marker. Earnings are passed in via prop so
   *     the caller can do the proportional split with the full per-card scope.
   */
  variant?: 'bar' | 'row';
  /**
   * Pre-computed EUR earnings for this entry, displayed in `row` mode. Caller
   * (WeekView) supplies it because `earningsForEntry` needs the full per-card
   * entry list, which the hook has but the chip doesn't.
   */
  earningsEur?: number;
  /**
   * S17: when provided, the chip becomes a `role="button"` and fires this
   * callback with the entry id on click / Enter / Space. Crucially it also
   * stops event propagation so the DayCell's "day click → add entry" handler
   * doesn't fire on top of the edit action.
   *
   * When omitted, the chip stays decorative (legacy MonthView read-only
   * behaviour) — no role, no tabindex, no keyboard handler.
   */
  onEdit?: (entryId: string) => void;
}

/**
 * Inline pill representing a single Entry inside a calendar cell or week
 * column. Uses the card's palette color for the colored bar; falls back to a
 * neutral gray when the card is missing (e.g. corrupt restore — shouldn't
 * happen but we don't crash on it).
 */
export function EntryChip({ entry, card, variant = 'bar', earningsEur, onEdit }: EntryChipProps) {
  const color = card?.color ?? '#94A3B8';
  const name = card?.name ?? '…';
  // S16b: lead chip text with the entry's start-of-day in HH:MM. Both
  // variants use the same prefix so Calendar Month/Day/Week surfaces read
  // chronologically at a glance.
  const startLabel = minutesToHHMM(entry.startMinutes);

  // S17: shared click/keyboard handler. `stopPropagation` is mandatory —
  // without it, a chip click bubbles to DayCell's wrapper onClick and triggers
  // the "add entry" flow on top of the edit. Tested in EntryChip.test.tsx
  // (`stopPropagation` case under `S17 onEdit wiring`).
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onEdit) return;
    e.stopPropagation();
    onEdit(entry.id);
  };
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onEdit) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onEdit(entry.id);
    }
  };

  // Common interactive-mode attributes. Spread on whichever variant renders
  // so we don't drift on a11y wiring between layouts.
  const interactiveProps = onEdit
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        'aria-label': `${startLabel} ${name}`,
      }
    : {};

  if (variant === 'row') {
    // S19 Task 12 — drop the leading color dot. The row variant uses a
    // colored left border (4px) so the card identity is still visible
    // without claiming the full row background.
    return (
      <div
        data-testid="entry-chip"
        {...interactiveProps}
        style={{ borderLeftColor: color }}
        className={cn(
          'flex items-center justify-between gap-2 rounded-md border border-l-4 px-2 py-1 text-xs',
          'border-border bg-background',
          // S17: hover affordance + focus ring when chip is interactive.
          // S18 will enforce a 44px tap target globally; the row variant is
          // already ≥40px due to py-1 + line-height.
          onEdit &&
            'hover:bg-accent/40 focus-visible:ring-ring cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            data-testid="entry-chip-time"
            className="text-muted-foreground shrink-0 tabular-nums"
          >
            {startLabel}
          </span>
          <span className="truncate font-medium">{name}</span>
          {entry.note != null && (
            <StickyNote
              data-testid="note-marker"
              aria-label="note"
              className="text-muted-foreground h-3 w-3 shrink-0"
            />
          )}
        </div>
        <div className="text-muted-foreground flex shrink-0 items-center gap-2">
          <span>{formatDuration(entry.durationMin)}</span>
          {earningsEur != null && <span>{earningsEur.toFixed(2)} EUR</span>}
        </div>
      </div>
    );
  }

  // S19 Task 12 — `bar` variant: keep the existing 20%-alpha tinted bg
  // (the bar IS the color cue). The leading dot is redundant against a
  // tinted background and was dropped per spec.
  return (
    <div
      data-testid="entry-chip"
      {...interactiveProps}
      className={cn(
        'flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] leading-tight',
        // S17: bar variant hover lift + focus ring. The chip lives inside a
        // DayCell which itself has a hover background — the chip needs a
        // discernible delta to read as "clickable on top of the cell".
        onEdit &&
          'focus-visible:ring-ring cursor-pointer transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-1',
      )}
      style={{ backgroundColor: `${color}33`, color: 'inherit' }}
      title={`${startLabel} · ${name} · ${formatDuration(entry.durationMin)}`}
    >
      <span data-testid="entry-chip-time" className="shrink-0 tabular-nums">
        {startLabel}
      </span>
      <span className="truncate">
        · {name} · {formatDuration(entry.durationMin)}
      </span>
    </div>
  );
}
