import { afterEach, describe, expect, it, vi } from 'vitest';

const initDB = vi.fn();
const pruneOldTombstones = vi.fn();
vi.mock('./repos/settings', () => ({ initDB: (...a: unknown[]) => initDB(...a) }));
vi.mock('./repos/tombstones', () => ({
  pruneOldTombstones: (...a: unknown[]) => pruneOldTombstones(...a),
}));

import { useDbStatus } from './dbStatus';
import { openDatabaseAtBoot } from './openAtBoot';
import type { HourTrackDB } from './schema';

/** Spec 009 — what boot does when IndexedDB will not open, or the prune fails. */

const fakeDb = {} as HourTrackDB;

afterEach(() => {
  useDbStatus.getState().reset();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('openDatabaseAtBoot', () => {
  it('a failed open shows the DB-interrupted screen and skips the prune', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    initDB.mockRejectedValueOnce(new Error('QuotaExceededError'));

    await openDatabaseAtBoot(fakeDb);

    expect(useDbStatus.getState().interruption).toBe('openFailed');
    expect(pruneOldTombstones).not.toHaveBeenCalled();
  });

  it('a failed prune is logged only — the app keeps working', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    initDB.mockResolvedValueOnce(undefined);
    pruneOldTombstones.mockRejectedValueOnce(new Error('prune'));

    await expect(openDatabaseAtBoot(fakeDb)).resolves.toBeUndefined();

    expect(useDbStatus.getState().interruption).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
