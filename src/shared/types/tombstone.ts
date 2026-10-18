/**
 * Tombstones express the *intent* "this entity was deleted on some device".
 *
 * Without tombstones, the absence of a card/entry from a snapshot is
 * ambiguous: it could mean "deleted on device A" OR "not yet synced from
 * device B". Tombstones disambiguate and let LWW merge correctly cascade
 * deletes across devices.
 *
 * Retention: 30 days. After that we assume every device has seen the delete
 * and drop the tombstone to keep the snapshot from growing unbounded. See
 * `features/sync/lwwMerge.ts` for the prune logic.
 */
export type TombstoneEntityType = 'card' | 'entry' | 'payment' | 'reminder';

export interface Tombstone {
  /** Stable identifier — must equal the deleted entity's `id`. */
  entityId: string;
  entityType: TombstoneEntityType;
  /** ISO timestamp of the delete. Used as the LWW timestamp for tombstones. */
  deletedAt: string;
}
