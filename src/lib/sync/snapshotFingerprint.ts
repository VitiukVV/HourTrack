import type { DriveSnapshot } from '@/shared/types';

/**
 * Do two snapshots hold the same rows? (spec 016, FR-006)
 *
 * Compares the `(id, updatedAt)` pairs of EVERY synced row store — cards,
 * entries, payments, reminders, month adjustments, shopping items — and the
 * `(entityType, entityId, deletedAt)` of the tombstones. LWW merge is decided
 * by exactly those fields, so two snapshots that agree on them merge to the
 * same result. Settings and `exportedAt` are deliberately ignored: they are
 * device-local or change on every build.
 *
 * Moved out of `bootstrap.ts`, which compared only cards, entries and
 * tombstones — a difference in the other stores never got uploaded.
 */
export function sameRows(a: DriveSnapshot, b: DriveSnapshot): boolean {
  return snapshotFingerprint(a) === snapshotFingerprint(b);
}

type Row = { id: string; updatedAt: string };

/**
 * One string per snapshot: per store, `id \0 updatedAt` sorted by id. The NUL
 * byte cannot occur in a uuid, a composite id or an ISO timestamp, so it is a
 * safe separator. Cheaper than `JSON.stringify` of the rows.
 */
export function snapshotFingerprint(s: DriveSnapshot): string {
  const stores: Row[][] = [
    s.cards,
    s.entries,
    s.payments ?? [],
    s.reminders ?? [],
    s.monthAdjustments ?? [],
    s.shoppingItems ?? [],
  ];
  const tombstones = (s.tombstones ?? []).map((t) => ({
    id: `${t.entityType}:${t.entityId}`,
    updatedAt: t.deletedAt,
  }));
  return [...stores, tombstones].map(fingerprintRows).join('\u0001');
}

function fingerprintRows(rows: Row[]): string {
  return rows
    .map((row) => `${row.id}\0${row.updatedAt}`)
    .sort()
    .join('\0');
}
