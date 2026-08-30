/**
 * How long a deletion is remembered.
 *
 * A tombstone exists to tell the OTHER device "this row is gone". Once both
 * sides have applied it, it is pure freight: it rides in every snapshot pushed
 * to Drive, is merged on every sync, and sits in IndexedDB for the life of the
 * install. So it expires.
 *
 * The window is applied in TWO places, and both must agree:
 *   - `pruneTombstones()` at boot — drops them from local storage;
 *   - `mergeTombstones()` on every merge — keeps them out of what we accept
 *     and, therefore, out of what we push.
 *
 * The price of the window: a device that has been offline LONGER than it, and
 * still holds a row deleted before it, resurrects that row on its next sync.
 * The default used to be 30 days, which is a plausible holiday — 180 makes it
 * a margin rather than a deadline. (my-diary landed on the same number after
 * the same reasoning; the value is a judgement call, the single source of
 * truth is not.)
 */
export const TOMBSTONE_TTL_DAYS = 180;

export const TOMBSTONE_TTL_MS = TOMBSTONE_TTL_DAYS * 24 * 60 * 60 * 1000;
