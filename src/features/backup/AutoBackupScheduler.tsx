import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useAuth } from '@/features/auth/authContext';
import { withFreshToken } from '@/lib/google/authorizedCall';

import { runAutoBackupIfDue } from './autoBackup';

/**
 * Mount-once React component that drives the auto-backup scheduler.
 *
 * Lifecycle:
 * - On mount + on every authed transition: check immediately whether a backup
 *   is due. This covers the "fired up the app after a week away" case.
 * - While mounted: tick once per hour. Per the sprint Notes the hour-tick is
 *   our chosen "while open" approximation. A 1-hour interval bounds the
 *   worst-case skew between "due" and "executed" to one hour, which is far
 *   below the daily granularity of `autoBackupIntervalDays`.
 *
 * Concurrency:
 * - We hold an `inFlight` ref so a slow upload doesn't get re-fired by the
 *   next hour-tick. If the previous tick is still resolving, this one
 *   short-circuits. The next tick after completion re-checks `lastBackupAt`
 *   and naturally skips if the previous tick succeeded.
 *
 * Errors:
 * - `runAutoBackupIfDue` never throws; it logs a failure and returns
 *   `failed`. Here a `failed` outcome raises ONE `backup.autoBackupFailed`
 *   toast per signed-in session (stable id) — otherwise automatic backups
 *   could stop for weeks unnoticed. (`BackupErrorBanner` covers only the
 *   manual "Create backup now" in Settings.) The hourly tick retries.
 *
 * Render: nothing. This component is invisible — it's a side-effect carrier.
 */

const HOUR_MS = 60 * 60 * 1000;
const AUTO_BACKUP_FAILED_TOAST_ID = 'backup-auto-failed';

export function AutoBackupScheduler() {
  const { status, tokens } = useAuth();
  const { t } = useTranslation();
  const inFlightRef = useRef<Promise<unknown> | null>(null);
  // Kept in refs so a language switch or a silent token renewal neither
  // restarts the schedule nor re-arms the once-per-session toast.
  const tRef = useRef(t);
  tRef.current = t;
  const failureToastShownRef = useRef(false);

  // Snapshot the values that matter for triggering. Re-running the effect when
  // these change is the whole point: a fresh sign-in (new accessToken/scope)
  // should kick off an immediate due-check.
  const accessToken = tokens?.accessToken ?? null;
  const grantedScopes = tokens?.scope ?? null;

  useEffect(() => {
    if (status !== 'authed') failureToastShownRef.current = false;
  }, [status]);

  useEffect(() => {
    if (status !== 'authed' || !accessToken) return;

    const tick = () => {
      if (inFlightRef.current) return;
      const p = runAutoBackupIfDue({
        accessToken,
        grantedScopes,
        withToken: withFreshToken,
      })
        .then((result) => {
          if (result.outcome !== 'failed' || failureToastShownRef.current) return;
          failureToastShownRef.current = true;
          toast.error(tRef.current('backup.autoBackupFailed'), { id: AUTO_BACKUP_FAILED_TOAST_ID });
        })
        .finally(() => {
          if (inFlightRef.current === p) inFlightRef.current = null;
        });
      inFlightRef.current = p;
    };

    // Initial check on mount / auth change.
    tick();
    const interval = setInterval(tick, HOUR_MS);
    return () => {
      clearInterval(interval);
    };
  }, [status, accessToken, grantedScopes]);

  return null;
}
