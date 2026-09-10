import type { Card } from '@hourtrack/shared-types';

/**
 * How a drag ended, as three cases the caller must treat differently.
 *
 *   - `moved` — write it.
 *   - `noop` — the chip was dropped on its own slot, or the pointer was
 *     released off the row (dnd-kit reports `over: null`). Nothing to write
 *     and nothing to say: the user did not ask for anything.
 *   - `stale` — the ids no longer match the rendered row, which is what a
 *     drag interrupted by a background sync looks like. This is NOT a no-op:
 *     the user asked for a move and is not getting it, so it has to be
 *     reported rather than silently dropped.
 *
 * An Escape cancel never reaches drag-end at all.
 */
export type CardReorderOutcome =
  { kind: 'moved'; toIndex: number } | { kind: 'noop' } | { kind: 'stale' };

export function resolveCardReorder(
  cards: Card[],
  activeId: string,
  overId: string | number | null | undefined,
): CardReorderOutcome {
  if (overId == null) return { kind: 'noop' };
  const from = cards.findIndex((c) => c.id === activeId);
  const to = cards.findIndex((c) => c.id === String(overId));
  if (from === -1 || to === -1) return { kind: 'stale' };
  if (from === to) return { kind: 'noop' };
  return { kind: 'moved', toIndex: to };
}

/**
 * Which card the moved card is landing next to, and on which side.
 *
 * The mutation patches several cached lists, and they are not the same
 * length: `['cards','all',true]` interleaves archived cards, so reusing the
 * active row's `toIndex` there drops the chip in the wrong slot. An anchor
 * card is meaningful in every list that contains it.
 *
 * `null` means "no anchor" — an empty row, or a single-card row — and the
 * caller should append.
 */
export function resolveReorderAnchor(
  activeRow: readonly Card[],
  cardId: string,
  toIndex: number,
): { id: string; side: 'before' | 'after' } | null {
  const without = activeRow.filter((c) => c.id !== cardId);
  if (without.length === 0) return null;
  const target = Math.min(Math.max(Math.trunc(toIndex), 0), without.length);
  const next = without[target];
  if (next) return { id: next.id, side: 'before' };
  // Past the end of the row: land after the last card that remains.
  return { id: without[without.length - 1]!.id, side: 'after' };
}
