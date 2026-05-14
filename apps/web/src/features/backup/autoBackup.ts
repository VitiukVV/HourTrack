import { db as defaultDb, getSettings, type HourTrackDB } from '@/lib/db';
import { SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { createBackup } from './backupService';

/**
 * Auto-backup scheduler.
 *
 * Cadence:
 * - On call to `runAutoBackupIfDue()`: read `Settings.autoBackupEnabled` and
 *   `Settings.autoBackupIntervalDays`. If enabled AND
 *   `now - lastBackupAt >= intervalDays * 24h`, trigger `createBackup()` in
 *   the background.
 * - The scheduler component (`AutoBackupScheduler`) calls this on mount AND
 *   once per hour while mounted. Hour-tick is the cheapest "while open"
 *   approximation per the sprint Notes ("setInterval(60 * 60 * 1000)").
 *
 * Non-blocking semantics (acceptance criterion):
 * - `runAutoBackupIfDue` returns a result object. It NEVER throws. On a
 *   failed backup it logs to console and records an `error` field; callers
 *   may surface a banner but the UI is never blocked.
 *
 * Scope + token defenses:
 * - If the user hasn't granted `drive.appdata`, skip silently with
 *   `'no-scope'`. The SyncIndicator already nags the user about re-consent;
 *   no need to duplicate.
 * - If no access token is available (auth state still loading, or user
 *   signed out between mount and tick), skip with `'no-token'`. Auto-backup
 *   is a best-effort background job; it must not race auth lifecycle.
 *
 * Idempotency:
 * - The function reads `lastBackupAt` ONCE per call. Two concurrent ticks
 *   could in theory both see "due" and both upload — same risk profile as
 *   `createBackup` itself. Both uploads would succeed and rotation would
 *   converge to 10 on the next run. Acceptable.
 */

export type AutoBackupOutcome =
  | 'created' // Backup actually ran and succeeded.
  | 'skipped-disabled' // Settings.autoBackupEnabled === false
  | 'skipped-not-due' // Within the interval window
  | 'skipped-no-settings' // Settings row missing (first boot before initDB)
  | 'no-scope' // User hasn't granted drive.appdata
  | 'no-token' // No access token available
  | 'failed'; // createBackup threw — see error

export interface AutoBackupResult {
  outcome: AutoBackupOutcome;
  error?: string;
}

export interface RunAutoBackupOptions {
  accessToken: string | null;
  grantedScopes: string | null;
  database?: HourTrackDB;
  fetchImpl?: typeof fetch;
  /** Override `now` for deterministic tests. */
  now?: Date;
}

const MS_PER_DAY = 86_400_000;

export async function runAutoBackupIfDue(opts: RunAutoBackupOptions): Promise<AutoBackupResult> {
  const database = opts.database ?? defaultDb;
  const now = opts.now ?? new Date();

  if (!opts.accessToken) return { outcome: 'no-token' };
  if (!opts.grantedScopes || !opts.grantedScopes.split(' ').includes(SCOPE_DRIVE_APPDATA)) {
    return { outcome: 'no-scope' };
  }

  const settings = await getSettings(database);
  if (!settings) return { outcome: 'skipped-no-settings' };
  if (!settings.autoBackupEnabled) return { outcome: 'skipped-disabled' };

  const intervalMs = Math.max(1, settings.autoBackupIntervalDays) * MS_PER_DAY;
  if (settings.lastBackupAt) {
    const last = Date.parse(settings.lastBackupAt);
    if (Number.isFinite(last) && now.getTime() - last < intervalMs) {
      return { outcome: 'skipped-not-due' };
    }
  }

  try {
    await createBackup({
      accessToken: opts.accessToken,
      database,
      fetchImpl: opts.fetchImpl,
      now,
    });
    return { outcome: 'created' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[autoBackup] createBackup failed:', msg);
    return { outcome: 'failed', error: msg };
  }
}
