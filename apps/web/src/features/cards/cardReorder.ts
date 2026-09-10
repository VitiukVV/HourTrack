import type { Card } from '@hourtrack/shared-types';

/**
 * Where a drag actually landed, or `null` when nothing should be written.
 *
 * `null` covers all three no-op endings the row has to handle: the chip was
 * dropped on its own slot, the pointer was released off the row (dnd-kit
 * reports `over: null`), and the ids no longer match the rendered row —
 * which is what a stale drag after a background sync would look like. An
 * Escape cancel never reaches drag-end at all.
 */
export function resolveCardReorder(
  cards: Card[],
  activeId: string,
  overId: string | number | null | undefined,
): number | null {
  if (overId == null) return null;
  const from = cards.findIndex((c) => c.id === activeId);
  const to = cards.findIndex((c) => c.id === String(overId));
  if (from === -1 || to === -1 || from === to) return null;
  return to;
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
