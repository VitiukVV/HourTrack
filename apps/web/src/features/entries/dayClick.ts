import type { Card, Entry } from '@hourtrack/shared-types';

/**
 * Inputs needed to decide what should happen when a calendar day cell is
 * clicked. The two maps come from `useEntriesInRange` (cardsById,
 * entriesByCard) — supplying them as plain `Map`s keeps this function pure,
 * synchronous, and trivially unit-testable.
 */
export interface DayClickInput {
  activeCardId: string | null;
  cardsById: Map<string, Card>;
  entriesByCard: Map<string, Entry[]>;
  /** YYYY-MM-DD local date string of the clicked cell. */
  date: string;
}

/**
 * Pure resolver. Returns the action the click should produce — the caller
 * runs the matching mutation or opens the picker modal.
 *
 * Branches (matches PROJECT_PLAN.md §8.1 + sprint S05):
 *   - `open-picker`: no active card → pop the no-active-card modal.
 *   - `create`:     active card set AND no existing entry for that card on
 *                    that date → caller creates a new entry using the card's
 *                    defaults.
 *   - `delete`:     active card set AND existing entry for that card on that
 *                    date → caller shows a confirm dialog then deletes.
 *
 * Defensive: if `activeCardId` references a card that no longer exists in
 * `cardsById` (e.g. archived in another tab and the active-card store still
 * holds the id), we fall back to `open-picker` rather than throwing.
 */
export type DayClickAction =
  | { kind: 'open-picker'; date: string }
  | { kind: 'create'; card: Card; date: string }
  | { kind: 'delete'; entry: Entry; card: Card; date: string };

export function dayClickAction(input: DayClickInput): DayClickAction {
  const { activeCardId, cardsById, entriesByCard, date } = input;
  if (!activeCardId) {
    return { kind: 'open-picker', date };
  }
  const card = cardsById.get(activeCardId);
  if (!card) {
    return { kind: 'open-picker', date };
  }
  const bucket = entriesByCard.get(activeCardId) ?? [];
  const sameDay = bucket.find((e) => e.date === date);
  if (sameDay) {
    return { kind: 'delete', entry: sameDay, card, date };
  }
  return { kind: 'create', card, date };
}
