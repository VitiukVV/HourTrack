import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useAuth } from '@/features/auth/authContext';
import { runBootstrap } from '@/features/sync/bootstrap';

/**
 * Wires Drive sync to the signed-in session (spec 005): runs the bootstrap
 * once per session. Lived in AuthProvider until sign-in and sync were
 * decoupled; mounted inside <AuthProvider> in app/routing/router.tsx.
 * Renders nothing. Pulled rows reach the UI through the live reads
 * (spec 006) — nothing here has to refresh anything.
 */
export function SyncOrchestrator(): null {
  const { tokens } = useAuth();
  const { t } = useTranslation();

  // Run sync bootstrap once per authed session. Fire-and-forget: bootstrap
  // failures are logged but don't block UI rendering. The SyncManager picks
  // up future writes via the normal enqueue path even when bootstrap fails.
  //
  // The guard is keyed on the SESSION, not the access token: silent token
  // refreshes (~hourly) mint a new accessToken, and keying on it re-ran the
  // full Drive pull + LWW merge + Dexie table rewrite on every refresh. We
  // reset the flag only when tokens clear (sign-out), so the next sign-in
  // bootstraps once more.
  const bootstrapRanRef = useRef(false);
  useEffect(() => {
    if (!tokens) {
      bootstrapRanRef.current = false;
      return;
    }
    if (bootstrapRanRef.current) return;
    bootstrapRanRef.current = true;
    void (async () => {
      try {
        const result = await runBootstrap({
          accessToken: tokens.accessToken,
          grantedScopes: tokens.scope,
        });
        if (result.outcome === 'no-scope') {
          // User revoked Drive access at myaccount.google.com between
          // logins. Without this toast they'd see the green "synced" dot
          // and assume backups are happening — they aren't.
          toast.error(t('sync.reconsentRequired'));
        } else if (result.outcome === 'failed') {
          console.warn('[sync] bootstrap failed:', result.error);
        }
        // S13: Calendar scope is independent of Drive. If Drive succeeded
        // but Calendar scope is missing, surface a parallel reconsent
        // toast so users don't silently lose calendar sync. (S12 followup
        // — previously the missing scope only surfaced as queued ops
        // accumulating with `lastError = 'Calendar scope not granted'`,
        // which the user never saw.)
        if (
          result.hasCalendarScope === false &&
          result.outcome !== 'no-scope' &&
          result.outcome !== 'no-token' &&
          result.outcome !== 'failed'
        ) {
          toast.error(t('googleCalendar.reconsentRequired'));
        }
      } catch (err) {
        console.warn('[sync] bootstrap threw:', err);
      }
    })();
    // `t` is a stable function from react-i18next; including it would
    // re-trigger the effect on every language switch and re-run bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  return null;
}
