import { db, getSettings, updateSettings } from '@/lib/db';
import type { HourTrackDB } from '@/lib/db';

/**
 * Per-device identifier used by `DriveSnapshot.deviceId` for conflict
 * detection. Generated once on first sync and persisted forever in the
 * Settings row.
 *
 * Why per-device (not per-user): a single user with two phones + a laptop
 * runs three concurrent "clients". The `deviceId` is the only stable
 * differentiator that survives Drive's eventual-consistency window: when we
 * read `data.json` and find `deviceId === ourDeviceId`, we know the last
 * write was OURS and the LWW merge can take shortcuts. When it's NOT ours,
 * we know the cloud has updates we don't.
 *
 * Generation uses `crypto.randomUUID()` (available in modern browsers and
 * the `happy-dom` test env). Falls back to a manual uuidv4 builder when
 * `crypto.randomUUID` is missing (very old Safari) so we never fail boot.
 */

function uuidv4Fallback(): string {
  // Manual RFC 4122 v4. Uses `Math.random` — fine for a device id where
  // collision probability is the only concern (no security claim).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return uuidv4Fallback();
}

/**
 * Read the current device id, generating + persisting one on first call.
 *
 * Idempotent: subsequent calls return the same id. The Settings row is
 * created with defaults if it doesn't yet exist (matches `initDB`'s lazy
 * seed pattern).
 */
export async function getOrCreateDeviceId(database: HourTrackDB = db): Promise<string> {
  const settings = await getSettings(database);
  if (settings?.deviceId) return settings.deviceId;
  const id = generateDeviceId();
  await updateSettings(database, { deviceId: id });
  return id;
}

/** Read-only accessor — returns `null` if not yet generated. */
export async function readDeviceId(database: HourTrackDB = db): Promise<string | null> {
  const settings = await getSettings(database);
  return settings?.deviceId ?? null;
}
