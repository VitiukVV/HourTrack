import { StickyNote } from 'lucide-react';

import type { Card, Entry } from '@hourtrack/shared-types';
import { formatDuration } from '@hourtrack/shared-utils';

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
}

/**
 * Inline pill representing a single Entry inside a calendar cell or week
 * column. Uses the card's palette color for the colored bar; falls back to a
 * neutral gray when the card is missing (e.g. corrupt restore — shouldn't
 * happen but we don't crash on it).
 */
export function EntryChip({ entry, card, variant = 'bar', earningsEur }: EntryChipProps) {
  const color = card?.color ?? '#94A3B8';
  const name = card?.name ?? '…';

  if (variant === 'row') {
    return (
      <div
        data-testid="entry-chip"
        className={cn(
          'flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs',
          'border-border bg-background',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
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

  return (
    <div
      data-testid="entry-chip"
      className={cn(
        'flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] leading-tight',
      )}
      style={{ backgroundColor: `${color}33`, color: 'inherit' }}
      title={`${name} · ${formatDuration(entry.durationMin)}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="truncate">
        {name} · {formatDuration(entry.durationMin)}
      </span>
    </div>
  );
}
