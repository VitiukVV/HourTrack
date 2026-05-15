/**
 * Entry -- one logged work session on a single calendar day for a single card.
 * Multiple entries per card per day ARE permitted (multi-session days).
 *
 * Mirrors PROJECT_PLAN.md §7.1 verbatim.
 */

/**
 * Reflects whether this entry has been pushed to Google Calendar.
 *
 * - `pending` -- queued for sync (default on create / after offline edit)
 * - `synced`  -- successfully written to Calendar; `googleEventId` populated
 * - `error`   -- last push failed; see `syncError` for human-readable detail
 */
export type SyncStatus = 'pending' | 'synced' | 'error';

export interface Entry {
  /** uuid v4 generated client-side. */
  id: string;
  cardId: string;
  /**
   * Local calendar date as `YYYY-MM-DD`. Produced by
   * `format(date, 'yyyy-MM-dd')` -- NEVER by `toISOString().slice(0,10)`
   * (timezone trap).
   */
  date: string;
  /**
   * Start time of day for this entry, expressed as minutes since local
   * midnight. Range: 0 (00:00) through 1439 (23:59) inclusive. Required
   * since DriveSnapshot v2.
   *
   * Invariant (enforced by `EntryEditorSchema`):
   *   `startMinutes + durationMin <= 1440`
   * — no past-midnight wrap in v2. Revisit only if a user reports the
   * limitation; the workaround is to log two entries for the same day, one
   * before and one after midnight.
   */
  startMinutes: number;
  /** Minutes actually worked. Always integer. */
  durationMin: number;
  /**
   * When true, earnings use `customPayment` instead of the card's rate.
   * See `earningsForEntry` for the precedence rules.
   */
  useCustomPayment: boolean;
  /**
   * EUR amount overriding rate-based calculation when
   * `useCustomPayment === true`. May legitimately exceed `hours × rate`.
   */
  customPayment: number | null;
  /** Entry-level note, independent from `Card.defaultNote`. */
  note: string | null;
  /** Google Calendar event id. Null until first successful sync. */
  googleEventId: string | null;
  syncStatus: SyncStatus;
  /** Last error message if `syncStatus === 'error'`, otherwise null. */
  syncError: string | null;
  /** ISO timestamp at creation. */
  createdAt: string;
  /** ISO timestamp of the most recent write. */
  updatedAt: string;
}
