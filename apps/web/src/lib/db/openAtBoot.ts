import { dbInterrupted } from './dbStatus';
import { initDB } from './repos/settings';
import { pruneOldTombstones } from './repos/tombstones';
import type { HourTrackDB } from './schema';

/**
 * Open IndexedDB, seed default Settings on first launch, then prune expired
 * tombstones. Fire-and-forget from `main.tsx`: the UI does not wait for it.
 *
 * Expired tombstones are dead weight: `lwwMerge` already refuses to carry them
 * into a snapshot, but nothing removed them from Dexie, so the store grew by a
 * row per deletion forever. Boot is the natural moment — off the render path,
 * exactly once.
 *
 * Spec 009: a failed open is not a console matter — nothing can be read or
 * saved, so the app swaps in the DB-interrupted screen with a Reload. A failed
 * prune only costs some disk space and stays in the console.
 */
export function openDatabaseAtBoot(db: HourTrackDB): Promise<void> {
  return initDB(db).then(
    () =>
      pruneOldTombstones(db).then(
        () => undefined,
        (err: unknown) => {
          console.error('[hourtrack] tombstone prune failed:', err);
        },
      ),
    (err: unknown) => {
      console.error('[hourtrack] initDB failed:', err);
      dbInterrupted('openFailed');
    },
  );
}
