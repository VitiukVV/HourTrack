import { memo, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { StickyNote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';

import type { Card, Entry } from '@hourtrack/shared-types';
import { formatDuration } from '@hourtrack/shared-utils';

import { minutesToHHMM } from '@/components/ui/TimeInput';
import { getReadableTextColor } from '@/lib/colors';
import { cn } from '@/lib/utils';

import type { EntryDragData } from './useEntryDrag';

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
  /**
   * S25 — opt-in drag source. When `true`, the chip becomes a
   * `useDraggable` source (the chip can be dragged onto another day to
   * reschedule it). `useDraggable` is ALWAYS called (Rules of Hooks); only
   * the `attributes`/`listeners`/drag-style spreads + the
   * `aria-roledescription` are gated on this flag, so legacy read-only
   * surfaces (and any non-calendar use) stay inert. Passed as a primitive so
   * `memo(EntryChip)` keeps its bailout (the parent threads a stable
   * boolean). Default `false`.
   */
  dragEnabled?: boolean;
}

/**
 * Inline pill representing a single Entry inside a calendar cell or week
 * column. Uses the card's palette color for the colored bar; falls back to a
 * neutral gray when the card is missing (e.g. corrupt restore — shouldn't
 * happen but we don't crash on it).
 */
function EntryChipImpl({
  entry,
  card,
  variant = 'bar',
  earningsEur,
  onEdit,
  dragEnabled = false,
}: EntryChipProps) {
  const { t } = useTranslation();
  const color = card?.color ?? '#94A3B8';
  const name = card?.name ?? '…';

  // S25 — drag source. `useDraggable` is called unconditionally (Rules of
  // Hooks) on EVERY chip so the hook subscription is stable; dnd-kit is
  // optimised so that an active drag only re-renders the dragged chip + the
  // hovered droppable, not all cells (verified — see EntryChip.test.tsx and
  // the S25 journal Profiler note). Only the attribute/listener/style spreads
  // below are gated on `dragEnabled`, so read-only surfaces stay inert.
  const dragData: EntryDragData = { entry, card };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.id,
    data: dragData,
    disabled: !dragEnabled,
  });

  // While dragging, fade the source chip — the `<DragOverlay>` clone is what
  // follows the pointer/finger. We deliberately do NOT translate the source
  // by `transform` (the overlay handles the visual move); we only dim it.
  const dragStyle: CSSProperties | undefined =
    dragEnabled && isDragging ? { opacity: 0.4 } : undefined;

  // S16b: lead `row` chip text with the entry's start-of-day in HH:MM.
  // The `bar` variant dropped its visible time prefix in S21 (UR-21-1)
  // but still uses startLabel in its `title` attribute for hover/tap-hold.
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

  // S25 — keyboard contract when a chip is BOTH editable (onEdit) AND a drag
  // source (dragEnabled):
  //   - Space  → dnd-kit KeyboardSensor pick-up/drop (drag). We let dnd-kit's
  //              own `listeners.onKeyDown` own Space by NOT handling it here.
  //   - Enter  → edit (open the modal), matching the S17 click affordance.
  // When NOT draggable, both Enter and Space edit (legacy S17 behaviour).
  // dnd-kit's keyboard listener is invoked first (composed below) so Space
  // starts a drag before our handler sees it.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onEdit) return;
    // When draggable, Space is reserved for drag pick-up (dnd-kit). Only
    // Enter triggers edit. When not draggable, Enter + Space both edit.
    const editKeys = dragEnabled ? ['Enter'] : ['Enter', ' '];
    if (editKeys.includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      onEdit(entry.id);
    }
  };

  // S25 — compose dnd-kit's keyboard listener with our edit handler. dnd-kit
  // runs first (so Space picks up the drag); then our handler runs for Enter.
  const dndKeyDown = listeners?.onKeyDown as
    | ((e: KeyboardEvent<HTMLDivElement>) => void)
    | undefined;
  const composedKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (dragEnabled && dndKeyDown) dndKeyDown(e);
    if (!e.defaultPrevented) handleKeyDown(e);
  };

  // Common interactive-mode attributes. Spread on whichever variant renders
  // so we don't drift on a11y wiring between layouts.
  const interactiveProps = onEdit
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: handleClick,
        onKeyDown: composedKeyDown,
        'aria-label': `${startLabel} ${name}`,
      }
    : {};

  // S25 — drag-source props. `useDraggable` is called unconditionally above
  // (Rules of Hooks). When `dragEnabled`, spread dnd-kit's `attributes`
  // (role/tabIndex/aria-*) + pointer `listeners`, plus our localized
  // `aria-roledescription`. We deliberately re-bind `onKeyDown` to the
  // composed handler (see above) AFTER spreading `listeners` so Enter still
  // edits. The chip's own `ref` is dnd-kit's `setNodeRef`.
  const dragProps = dragEnabled
    ? {
        ref: setNodeRef,
        ...attributes,
        ...listeners,
        'aria-roledescription': t('calendar.dnd.draggable'),
      }
    : {};

  if (variant === 'row') {
    // The row variant now uses the FULL card color as background (no longer
    // a 4px left-accent on a neutral row). Card identity reads at a glance
    // for the WeekView + agenda layouts; secondary metadata (time, duration,
    // earnings) renders in the same readable-on-color tone with reduced
    // opacity so it stays subordinate to the card name without dropping
    // contrast on dark palette colors.
    const readable = getReadableTextColor(color);
    return (
      <div
        data-testid="entry-chip"
        {...dragProps}
        {...interactiveProps}
        style={{ backgroundColor: color, color: readable, ...dragStyle }}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs',
          // S17: hover affordance + focus ring when chip is interactive.
          // S18 will enforce a 44px tap target globally; the row variant is
          // already ≥40px due to py-1 + line-height.
          onEdit &&
            'focus-visible:ring-ring cursor-pointer transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
          // S25 — grab affordance on fine pointers (desktop). Touch uses
          // press-and-hold so NO `touch-action: none` (that would kill list
          // scroll — S0b). The TouchSensor delay (220ms) gates scroll-vs-drag.
          dragEnabled && 'sm:cursor-grab sm:active:cursor-grabbing',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span data-testid="entry-chip-time" className="shrink-0 tabular-nums opacity-80">
            {startLabel}
          </span>
          <span className="truncate font-medium">{name}</span>
          {entry.note != null && (
            <StickyNote
              data-testid="note-marker"
              role="img"
              aria-label={t('calendar.hasNote')}
              className="h-3 w-3 shrink-0 opacity-80"
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 opacity-80">
          <span>{formatDuration(entry.durationMin)}</span>
          {earningsEur != null && <span>{earningsEur.toFixed(2)} EUR</span>}
        </div>
      </div>
    );
  }

  // `bar` variant is NAME-ONLY (S21 UR-21-1 — leading start time and trailing
  // duration text are dropped to reduce visual density in MonthView). The
  // chip's background is now the FULL card color across the FULL row width
  // (`w-full` + `block` flex) so each entry reads as a solid card-colored
  // block inside the day cell — not a content-sized pill leaving the
  // background showing on either side. Text color picked by
  // `getReadableTextColor` for WCAG contrast. The `title` attribute keeps
  // the "HH:MM · name · duration" data for hover / tap-hold.
  return (
    <div
      data-testid="entry-chip"
      {...dragProps}
      {...interactiveProps}
      className={cn(
        'flex w-full items-center truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight',
        // Hover lift + focus ring. The chip lives inside a DayCell which
        // itself has a hover background — the chip needs a discernible
        // delta to read as "clickable on top of the cell".
        onEdit &&
          'focus-visible:ring-ring cursor-pointer transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-1',
        // Interactive chips are the ONLY way to edit an entry from MonthView,
        // and a mis-tap falls through to the DayCell's create/delete handler.
        // The S21 name-only bar is ~18px tall — below the 44px target the
        // rest of the app enforces. Give it a comfortable minimum height on
        // touch (coarse-pointer) viewports while leaving the dense desktop
        // layout untouched at `sm:+`.
        onEdit && 'min-h-[28px] sm:min-h-0',
        // S25 — grab affordance on fine pointers only (see row variant note).
        dragEnabled && 'sm:cursor-grab sm:active:cursor-grabbing',
      )}
      style={{ backgroundColor: color, color: getReadableTextColor(color), ...dragStyle }}
      title={`${startLabel} · ${name} · ${formatDuration(entry.durationMin)}`}
    >
      <span className="truncate">{name}</span>
    </div>
  );
}

/**
 * S23 — `React.memo` with default shallow equality. Props are:
 *   - `entry`         — comes from a stable Map bucket inside
 *                       `useEntriesInRange`. After S23 Part C's surgical
 *                       patches, the entry reference is stable across
 *                       mutations that don't touch this specific entry.
 *   - `card`          — Map lookup; stable until a cards mutation triggers
 *                       a refetch.
 *   - `variant`/`earningsEur` — primitives.
 *   - `onEdit`        — caller MUST wrap in `useCallback` (otherwise the
 *                       memo is a no-op). MonthView, WeekView, and
 *                       WeekAgendaView are updated to stabilise their
 *                       chip-edit handlers as part of S23.
 */
export const EntryChip = memo(EntryChipImpl);
