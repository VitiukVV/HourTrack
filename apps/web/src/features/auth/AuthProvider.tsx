import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  getUserInfo,
  revoke as revokeGoogleToken,
  signIn as gisSignIn,
} from '@/lib/google/gisClient';
import {
  clearTokens,
  setTokens,
  setUserProfile,
  subscribe as subscribeTokens,
  type AuthTokens,
} from '@/lib/google/tokenStore';
import { startTokenRefresh } from '@/lib/google/tokenRefresh';
import { db, getSettings, updateSettings } from '@/lib/db';
import { runBootstrap } from '@/features/sync/bootstrap';
import { subscribeSnapshotApplied } from '@/features/sync/snapshotEvents';

import { AuthContext, type AuthContextValue, type AuthStatus, type AuthUser } from './authContext';

/**
 * React provider for the auth state machine. Subscribes to the token store
 * for cross-component updates, starts the refresh worker when authed, and
 * exposes `signIn` / `signOut` callbacks.
 *
 * Logout flow per spec (PROJECT_PLAN section 9.1):
 *   1. Revoke the access token at Google (best-effort, may fail offline)
 *   2. Clear the Dexie `authTokens` row
 *   3. Invalidate every protected TanStack Query so the next render does not
 *      flash stale user-scoped data
 *   4. Status transitions to `'anonymous'` via the tokenStore subscription
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokensState] = useState<AuthTokens | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const qc = useQueryClient();
  const { t } = useTranslation();
  // We need a stable reference to the refresh-loop disposer so we can stop
  // the previous loop when tokens change or on unmount.
  const stopRefreshRef = useRef<(() => void) | null>(null);

  // S29 (UR-29-2): when a Drive pull (bootstrap merge or 412 merge) applies
  // new rows to Dexie, the sync layer emits `snapshot-applied`. Invalidate the
  // synced query caches here — next to the QueryClientProvider — so the pulled
  // data reaches the UI without a manual reload. Coarse per-store keys so any
  // parameterized child key (e.g. `['payments','period',p]`, `['entries',...]`)
  // is covered by prefix match.
  useEffect(() => {
    return subscribeSnapshotApplied(() => {
      void qc.invalidateQueries({ queryKey: ['entries'] });
      void qc.invalidateQueries({ queryKey: ['cards'] });
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
    });
  }, [qc]);

  // Subscribe to tokenStore changes. The subscribe helper fires the listener
  // immediately with the current snapshot, so we don't need a separate
  // initial read.
  useEffect(() => {
    const unsub = subscribeTokens((next) => {
      setTokensState(next);
      if (next) {
        setStatus('authed');
      } else {
        setStatus('anonymous');
        setUser(null);
      }
    });
    return unsub;
  }, []);

  // Fetch user-info on first authed transition. The result is also cached
  // into the tokenStore row so a page reload doesn't trigger a fresh fetch.
  useEffect(() => {
    if (!tokens) return;
    // If we already have cached profile data, use it without re-fetching.
    if (tokens.email) {
      setUser({
        email: tokens.email,
        name: tokens.name,
        picture: tokens.picture,
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const info = await getUserInfo(tokens.accessToken);
        if (cancelled) return;
        const next: AuthUser = {
          email: info.email,
          name: info.name ?? null,
          picture: info.picture ?? null,
        };
        setUser(next);
        await setUserProfile({
          email: next.email,
          name: next.name,
          picture: next.picture,
        });
        // First-login marker: set Settings.firstLoginAt once. The marker is
        // consumed by S13 onboarding to decide whether to launch the tour.
        const settings = await getSettings(db);
        if (settings && !settings.firstLoginAt) {
          await updateSettings(db, { firstLoginAt: new Date().toISOString() });
        }
      } catch (err) {
        // Surface to console; the AuthProvider still considers the user
        // authed (access token works for protected calls), only the profile
        // display is missing.
        console.warn('[auth] getUserInfo failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokens]);

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
          console.warn('[auth] sync bootstrap failed:', result.error);
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
        console.warn('[auth] sync bootstrap threw:', err);
      }
    })();
    // `t` is a stable function from react-i18next; including it would
    // re-trigger the effect on every language switch and re-run bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  // Manage the refresh loop. Start on transition into `authed`; stop when
  // tokens go away or component unmounts.
  useEffect(() => {
    if (!tokens) {
      if (stopRefreshRef.current) {
        stopRefreshRef.current();
        stopRefreshRef.current = null;
      }
      return;
    }
    // Stop any previous loop before starting a new one (idempotent).
    if (stopRefreshRef.current) {
      stopRefreshRef.current();
    }
    stopRefreshRef.current = startTokenRefresh({
      onAuthLost: () => {
        // Auth loss is surfaced through the tokenStore subscription
        // (clearTokens was called inside the worker). Nothing extra to do
        // here, but keep the hook so callers can extend it.
      },
    });
    return () => {
      if (stopRefreshRef.current) {
        stopRefreshRef.current();
        stopRefreshRef.current = null;
      }
    };
    // We deliberately re-run only when the access token identity changes —
    // not on every cached profile re-write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens?.accessToken]);

  const signIn = useMemo(
    () => async (): Promise<void> => {
      const res = await gisSignIn();
      await setTokens({
        accessToken: res.access_token,
        accessTokenExpiresAt: Date.now() + res.expires_in * 1000,
        refreshToken: res.refresh_token ?? null,
        idToken: res.id_token ?? null,
        scope: res.scope,
      });
    },
    [],
  );

  const signOut = useMemo(
    () => async (): Promise<void> => {
      const current = tokens;
      if (current) {
        // Revoke is best-effort. We do not block local sign-out on its
        // success — offline users should still be able to log out.
        await revokeGoogleToken(current.accessToken).catch(() => {
          /* swallow */
        });
      }
      await clearTokens();
      // Invalidate any user-scoped queries. We use a coarse predicate that
      // matches every query — downstream sprints (S10 Drive, S12 Calendar)
      // will land their query keys after this lands so the predicate
      // automatically covers them.
      await qc.invalidateQueries();
    },
    // qc is stable across renders; tokens reference is the live snapshot we
    // want at signOut call time. The closure capture is intentional.
    [tokens, qc],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, tokens, signIn, signOut }),
    [status, user, tokens, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// `useAuth` and the auth types live in `./authContext` so that this module
// only exports React components (Fast Refresh constraint). Consumers should
// import from `@/features/auth/authContext`.
