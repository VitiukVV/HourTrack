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
}
