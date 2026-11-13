import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useAuth } from '@/features/auth/authContext';
import { applyUpdateOrReload, checkForUpdate } from '@/features/pwa/checkForUpdate';
import { isPullSuccess } from '@/features/sync/bootstrap';
import { startSessionPull } from '@/features/sync/sessionPull';
import { getSyncManager } from '@/features/sync/SyncManager';
import { SYNC_UPDATE_REQUIRED } from '@/features/sync/syncErrorMessage';

/** Consecutive failed pulls before the user is told (the retries usually win). */
const PULL_FAILURES_BEFORE_TOAST = 3;
/** Stable id: one "could not load" toast however often it is raised. */
const PULL_FAILED_TOAST_ID = 'sync-pull-failed';

/**
 * Wires Drive sync to the signed-in session (spec 005, spec 016): while
 * signed in, `startSessionPull` pulls at session start, on return to the app
 * and when the connection returns, and retries a failed pull. Mounted inside
 * <AuthProvider> in app/routing/router.tsx. Renders nothing. Pulled rows
 * reach the UI through the live reads (spec 006).
 *
 * The session is keyed on being signed in, not on the access token: silent
 * renewals (~hourly) mint a new token and must not restart the session. The
 * pull reads (and renews) the token itself.
 */
export function SyncOrchestrator(): null {
  const { tokens } = useAuth();
  const { t } = useTranslation();
  // Kept in a ref so a language switch does not restart the session.
  const tRef = useRef(t);
  tRef.current = t;
  const signedIn = tokens !== null;

  useEffect(() => {
    if (!signedIn) return;
    // Each toast at most once per session.
    let driveToastShown = false;
    let calendarToastShown = false;
    let updateToastShown = false;
    let pullFailedToastShown = false;
    let consecutivePullFailures = 0;

    // Spec 016 FR-008: the shared data was written by a newer app. Either a
    // pull (outcome) or a push (status) can find out first.
    const announceUpdateRequired = () => {
      if (updateToastShown) return;
      updateToastShown = true;
      toast.error(tRef.current('sync.updateRequired'), {
        duration: Infinity,
        action: { label: tRef.current('pwa.reload'), onClick: applyUpdateOrReload },
      });
      checkForUpdate();
    };

    // The session keeps retrying a failed pull; the indicator already reads
    // 'error'. Say it in words once the retries have clearly not helped — or
    // at once when retrying cannot help (a bug, a local-database failure).
    const announcePullFailed = () => {
      if (pullFailedToastShown) return;
      pullFailedToastShown = true;
      toast.error(tRef.current('sync.pullFailed'), { id: PULL_FAILED_TOAST_ID });
    };

    const unsubscribe = getSyncManager().subscribe((status, lastError) => {
      if (status === 'error' && lastError === SYNC_UPDATE_REQUIRED) announceUpdateRequired();
    });

    const stopPulls = startSessionPull({
      onResult: (result) => {
        if (result.outcome === 'no-scope' && !driveToastShown) {
          // User revoked Drive access at myaccount.google.com between
          // logins. Without this toast they'd see the green "synced" dot
          // and assume backups are happening — they aren't.
          driveToastShown = true;
          toast.error(tRef.current('sync.reconsentRequired'));
        } else if (result.outcome === 'update-required') {
          announceUpdateRequired();
        } else if (result.outcome === 'failed') {
          consecutivePullFailures += 1;
          if (result.unexpected) {
            console.error('[sync] pull failed unexpectedly:', result.error);
            announcePullFailed();
          } else {
            console.warn('[sync] pull failed:', result.error);
            if (consecutivePullFailures >= PULL_FAILURES_BEFORE_TOAST) announcePullFailed();
          }
        }
        if (isPullSuccess(result.outcome)) {
          consecutivePullFailures = 0;
          // Calendar scope is independent of Drive. If Drive worked but the
          // Calendar scope is missing, say so — otherwise calendar changes
          // just pile up in the queue unseen.
          if (!result.hasCalendarScope && !calendarToastShown) {
            calendarToastShown = true;
            toast.error(tRef.current('googleCalendar.reconsentRequired'));
          }
        }
      },
    });

    return () => {
      stopPulls();
      unsubscribe();
    };
  }, [signedIn]);

  return null;
}
