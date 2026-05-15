/**
 * Settings -- single-row table holding user preferences plus sync/backup
 * metadata. Mirrors PROJECT_PLAN.md §7.1 verbatim.
 *
 * The Dexie store key is the literal string 'current' -- there is exactly
 * one Settings row at all times.
 */

export type Language = 'uk' | 'en' | 'es';
export type Theme = 'system' | 'light' | 'dark';
export type CalendarView = 'month' | 'week';

export interface Settings {
  language: Language;
  theme: Theme;
  /** Which calendar layout to open on app launch. */
  defaultView: CalendarView;
  /**
   * Google Calendar id for the "HourTrack" calendar created on first sync.
   * Null until S12 wires the create-calendar flow.
   */
  hourtrackCalendarId: string | null;
  /** Master toggle for the 3-day auto-backup job. Default true. */
  autoBackupEnabled: boolean;
  /** Backup cadence; defaults to 3 per the spec. */
  autoBackupIntervalDays: number;
  /** ISO timestamp of the most recent successful backup; null until first run. */
  lastBackupAt: string | null;
  /** ISO timestamp of the most recent successful Drive sync push or pull. */
  lastSyncAt: string | null;
  /**
   * ISO timestamp of the user's first successful Google sign-in. S09 sets this
   * once on the initial auth; S13 uses it to decide whether to launch the
   * onboarding tour. Null until first login.
   */
  firstLoginAt: string | null;
  /**
   * Stable per-device uuid v4. Generated on first run and persisted forever.
   * Embedded into every `DriveSnapshot.deviceId` so SyncManager can recognise
   * "our last write was from THIS device" during conflict detection. Null
   * until S10 sync first runs on this device.
   */
  deviceId: string | null;
  /**
   * Drive file id of the canonical `data.json` snapshot, cached after the first
   * read/create. Lets later writes skip the find-by-name lookup. Null until
   * the first successful sync.
   */
  driveDataFileId: string | null;
  /**
   * Last known Drive ETag for `data.json`. Sent as `If-Match` on the next
   * update. A `412 Precondition Failed` reply triggers the pull-merge-push
   * conflict resolution path in `SyncManager`. Null until the first read.
   */
  driveDataEtag: string | null;
  /**
   * Has the user already seen (or skipped) the 3-step onboarding tour? S13
   * sets this to `true` on tour completion or skip. Default `false` for new
   * Settings rows; pre-S13 Settings rows are migrated to `false` by the
   * Dexie v4 upgrade. Synced across devices via the standard "newer
   * exportedAt wins" Settings LWW path — once the user dismisses on device
   * A the dismissal propagates to device B.
   */
  onboardingSeen: boolean;
}
