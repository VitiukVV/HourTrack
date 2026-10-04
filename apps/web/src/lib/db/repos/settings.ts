import type { Language, Settings } from '@hourtrack/shared-types';

import type { HourTrackDB, SettingsRow } from '../schema';
import { nowIso } from '../mutate';

const SETTINGS_KEY = 'current' as const;
const SUPPORTED_LANGUAGES = ['uk', 'en', 'es'] as const;

function detectLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en';
  const tag = (navigator.language || 'en').toLowerCase();
  const base = tag.split('-')[0] as string | undefined;
  if (!base) return 'en';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base) ? (base as Language) : 'en';
}

/** Default Settings row applied the first time the app opens on a device. */
export function defaultSettings(): Settings {
  return {
    language: detectLanguage(),
    theme: 'system',
    defaultView: 'month',
    hourtrackCalendarId: null,
    autoBackupEnabled: true,
    autoBackupIntervalDays: 3,
    lastBackupAt: null,
    lastSyncAt: null,
    firstLoginAt: null,
    deviceId: null,
    driveDataFileId: null,
    driveDataEtag: null,
    onboardingSeen: false,
  };
}

/**
 * Idempotent: seeds the single `settings` row if it doesn't exist yet. Safe
 * to call on every app boot.
 */
export async function initDB(db: HourTrackDB): Promise<void> {
  const existing = await db.settings.get(SETTINGS_KEY);
  if (existing) return;
  const row: SettingsRow = { key: SETTINGS_KEY, ...defaultSettings() };
  await db.settings.put(row);
}

/** Strip the `key` discriminator to get the public Settings shape. */
function toSettings(row: SettingsRow): Settings {
  const { key: _key, ...rest } = row;
  return rest;
}

export async function getSettings(db: HourTrackDB): Promise<Settings | null> {
  const row = await db.settings.get(SETTINGS_KEY);
  return row ? toSettings(row) : null;
}

/**
 * User-preference fields (as opposed to device-local bookkeeping). A write
 * that touches any of these stamps `settingsUpdatedAt` (S29 Task 6) so the
 * LWW merge can tell a genuine preference change from a routine bookkeeping
 * push. `hourtrackCalendarId` / `driveData*` / `lastSyncAt` / `lastBackupAt` /
 * `firstLoginAt` / `deviceId` / `onboardingSeen` are deliberately EXCLUDED —
 * they are bookkeeping / monotonic fields, not user preferences.
 */
const PREFERENCE_KEYS: ReadonlyArray<keyof Settings> = [
  'language',
  'theme',
  'defaultView',
  'autoBackupEnabled',
  'autoBackupIntervalDays',
];

/**
 * Apply a partial patch to the (always single) settings row. The row is
 * created with defaults if it does not yet exist.
 *
 * S29 Task 7 — the read-modify-write runs inside a single `rw` transaction so
 * concurrent patches (SyncManager bookkeeping vs a UI toggle vs ensureCalendar
 * vs autoBackup) can't clobber each other: IndexedDB serialises readwrite
 * transactions over the `settings` store, so each caller sees the previous
 * caller's write as its base instead of a stale snapshot.
 *
 * S29 Task 6 — a patch that touches any user-preference field stamps
 * `settingsUpdatedAt` (unless the caller supplied one explicitly), which
 * `lwwMerge.mergeSettings` uses to resolve preference conflicts.
 */
export async function updateSettings(db: HourTrackDB, patch: Partial<Settings>): Promise<Settings> {
  const touchesPrefs = PREFERENCE_KEYS.some((k) => k in patch);
  return db.transaction('rw', db.settings, async () => {
    const existing = await db.settings.get(SETTINGS_KEY);
    const base: Settings = existing ? toSettings(existing) : defaultSettings();
    const next: Settings = { ...base, ...patch };
    if (touchesPrefs && !('settingsUpdatedAt' in patch)) {
      next.settingsUpdatedAt = nowIso();
    }
    await db.settings.put({ key: SETTINGS_KEY, ...next });
    return next;
  });
}
