import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useAuth } from '@/features/auth/authContext';
import type { BootstrapResult } from '@/features/sync/bootstrap';
import { startSessionPull } from '@/features/sync/sessionPull';

const PULL_SUCCEEDED: ReadonlySet<BootstrapResult['outcome']> = new Set([
  'created',
  'pulled',
  'unchanged',
]);

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
    // Each reconsent toast at most once per session.
    let driveToastShown = false;
    let calendarToastShown = false;
    return startSessionPull({
      onResult: (result) => {
        if (result.outcome === 'no-scope' && !driveToastShown) {
          // User revoked Drive access at myaccount.google.com between
          // logins. Without this toast they'd see the green "synced" dot
          // and assume backups are happening — they aren't.
          driveToastShown = true;
          toast.error(tRef.current('sync.reconsentRequired'));
        } else if (result.outcome === 'failed') {
          console.warn('[sync] pull failed:', result.error);
        }
        // S13: Calendar scope is independent of Drive. If Drive worked but
        // the Calendar scope is missing, say so — otherwise calendar changes
        // just pile up in the queue unseen.
        if (PULL_SUCCEEDED.has(result.outcome) && !result.hasCalendarScope && !calendarToastShown) {
          calendarToastShown = true;
          toast.error(tRef.current('googleCalendar.reconsentRequired'));
        }
      },
    });
  }, [signedIn]);

  return null;
}
