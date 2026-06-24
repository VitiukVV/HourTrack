import type { Entry } from '@hourtrack/shared-types';

/**
 * S25 — pure, framework-free resolver for a drag-to-reschedule drop.
 *
 * Given the dragged entry (only `id` + `date` matter) and the date id of the
 * droppable cell it was released over, decide whether a move should fire.
 *
 * Returns the `{ id, patch: { date } }` payload for
 * `useUpdateEntryMutation().mutate(...)` when the drop is a real move, or
 * `null` when the drop is a no-op:
 *   - same-day drop (`toDate === entry.date`): MANDATORY short-circuit. A drop
 *     back on the origin day must NOT fire a mutation or a Calendar PATCH —
 *     otherwise every accidental pick-up-and-drop costs a needless sync
 *     round-trip (spec Notes "Same-day no-op is mandatory").
 *   - malformed `toDate` (not a strict `YYYY-MM-DD` string): defensive null so
 *     a stray droppable id can never produce an invalid `date` patch.
 *
 * Reschedule changes ONLY `date`. `startMinutes`, `durationMin`, payment fields
 * and `note` are untouched — the patch carries `date` alone, so the existing
 * surgical range-cache patch (S23) + Calendar PATCH path move the entry without
 * disturbing anything else.
 */

// Strict `YYYY-MM-DD` shape. Mirrors the validation the calendar surfaces use
// for cell ids (`formatLocalDate`). We accept the canonical zero-padded form
// only; anything else is treated as a bad droppable id.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface EntryMove {
  id: string;
  patch: { date: string };
}

export function resolveEntryMove(
  entry: Pick<Entry, 'id' | 'date'>,
  toDate: string,
): EntryMove | null {
  // Defensive: a droppable id that isn't a well-formed date never moves.
  if (typeof toDate !== 'string' || !ISO_DATE_RE.test(toDate)) return null;
  // Reject impossible calendar dates that still match the shape (e.g.
  // 2026-13-40) — `Date.parse` on the canonical form gives NaN for those.
  const parsed = Date.parse(`${toDate}T00:00:00`);
  if (Number.isNaN(parsed)) return null;
  // Same-day drop → no-op (no mutation, no Calendar PATCH, no toast).
  if (toDate === entry.date) return null;
  return { id: entry.id, patch: { date: toDate } };
}
