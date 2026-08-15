import type { Entry } from '@hourtrack/shared-types';

/**
 * THE ordering rule for entries on any surface that lists them (S32).
 *
 * Every read path — the calendar range query, the DayPage by-date query, the
 * snapshot builder, the optimistic cache patch, and the Reports `byEntry`
 * table — sorts through this one comparator. That is the point: the
 * optimistic cache (rendered immediately after a save) and the refetched
 * cache must never disagree about which entry comes first, and before S32
 * they did — the calendar ordered by `createdAt` (insertion order, frozen at
 * creation, so editing a start time never reordered anything) while
 * `getEntriesByDate` did not sort at all.
 *
 * Five tiers:
 *
 *   1. `date`         ASC  — YYYY-MM-DD, so a plain string compare is correct.
 *   2. `startMinutes` ASC  — chronological within the day.
 *   3. `durationMin`  DESC — of two entries starting at the same minute, the
 *                            longer one comes first.
 *   4. `createdAt`    ASC  — ISO strings, so again a string compare.
 *   5. `id`           ASC  — absolute stability (preserves the S16b contract).
 *
 * Tiers 1-3 are Google Calendar's rule, deliberately: these entries sync to
 * Calendar (S12), so the user reads the two surfaces side by side and expects
 * them to agree. Google breaks a start+duration tie by event *title*; we
 * can't, because this comparator takes an `Entry` and has no card name (the
 * DB layer returns entries without cards — threading `cardsById` through
 * `getEntriesByDate` / `getAllEntries` / the snapshot builder for a cosmetic
 * tie is not worth it). `createdAt` stands in: entries sharing a start time
 * are usually siblings that inherited `card.defaultStartMinutes`, and
 * creation order is what a user expects of those. `id` is a uuid — random,
 * hence last-resort only.
 *
 * Non-finite `startMinutes` / `durationMin` are coerced to 0. Every stored
 * entry has both (the destructive Dexie v5 migration wiped the pre-S16 rows
 * that lacked them), so this is unreachable in practice — but a corrupt row
 * pulled from Drive must not be able to inject `NaN` into a comparison and
 * make `Array.prototype.sort` non-deterministic.
 */
export function compareEntriesForDisplay(a: Entry, b: Entry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;

  const aStart = finite(a.startMinutes);
  const bStart = finite(b.startMinutes);
  if (aStart !== bStart) return aStart - bStart;

  // DESC — the longer entry first.
  const aDuration = finite(a.durationMin);
  const bDuration = finite(b.durationMin);
  if (aDuration !== bDuration) return bDuration - aDuration;

  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
