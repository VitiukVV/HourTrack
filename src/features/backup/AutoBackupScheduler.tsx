import { useEffect, useRef } from 'react';

import { useAuth } from '@/features/auth/authContext';

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
 * - `runAutoBackupIfDue` never throws. Failures are recorded in console for
 *   dev visibility; the user-facing error surface lives in
 *   `BackupErrorBanner` (driven by `Settings.lastBackupAt` staleness +
 *   recent failure history, neither of which is on the critical path).
 *
 * Render: nothing. This component is invisible — it's a side-effect carrier.
 */

const HOUR_MS = 60 * 60 * 1000;

export function AutoBackupScheduler() {
  const { status, tokens } = useAuth();
  const inFlightRef = useRef<Promise<unknown> | null>(null);

  // Snapshot the values that matter for triggering. Re-running the effect when
  // these change is the whole point: a fresh sign-in (new accessToken/scope)
  // should kick off an immediate due-check.
  const accessToken = tokens?.accessToken ?? null;
  const grantedScopes = tokens?.scope ?? null;

  useEffect(() => {
    if (status !== 'authed' || !accessToken) return;

    const tick = () => {
      if (inFlightRef.current) return;
      const p = runAutoBackupIfDue({
        accessToken,
        grantedScopes,
      }).finally(() => {
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
