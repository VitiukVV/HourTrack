import { useEffect, useState } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/authContext';
import { getGoogleClientId } from '@/lib/google/config';
import { isGisReady, waitForGisReady } from '@/lib/google/gisClient';

/**
 * Login screen. Centered "Sign in with Google" button. Three modes:
 *
 *   1. Configured + SDK ready + anonymous   -- enabled button.
 *   2. Configured + SDK still loading       -- disabled button with hint.
 *   3. Not configured (no env var)          -- friendly "OAuth not configured"
 *                                                message.
 *
 * On successful sign-in, navigate to the `from` location passed by the
 * `RequireAuth` guard, or `/` by default.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as Location & { state?: { from?: string } };
  const [busy, setBusy] = useState(false);
  const [sdkReady, setSdkReady] = useState(() => isGisReady());
  const configured = getGoogleClientId() !== null;

  // Poll for GIS readiness on mount. The SDK is loaded via the `<script>`
  // tag in `index.html` with `async defer` so it may not be ready by the
  // time React mounts the page.
  useEffect(() => {
    if (sdkReady) return;
    let cancelled = false;
    void waitForGisReady(15_000)
      .then(() => {
        if (!cancelled) setSdkReady(true);
      })
      .catch(() => {
        // Surface a soft warning -- the button stays disabled.
        if (!cancelled) {
          console.warn('[LoginPage] GIS SDK did not load within 15s');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sdkReady]);

  // If we're already authed (e.g. user navigated to /login manually after
  // logging in via a different tab), redirect to the post-login destination.
  useEffect(() => {
    if (status === 'authed') {
      const destination = location.state?.from ?? '/';
      navigate(destination, { replace: true });
    }
  }, [status, location.state, navigate]);

  const onSignIn = async (): Promise<void> => {
    setBusy(true);
    try {
      await signIn();
      // AuthProvider flips status to `authed` on tokenStore subscription;
      // the redirect effect above takes over from there.
    } catch (err) {
      console.warn('[LoginPage] signIn failed', err);
      toast.error(t('auth.login.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="login-page" className="flex min-h-dvh items-center justify-center p-4">
      <div className="border-border bg-card text-card-foreground w-full max-w-sm rounded-lg border p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">{t('app.title')}</h1>
        <p className="text-muted-foreground mb-4 text-sm" data-testid="login-page-subtitle">
          {t('auth.login.title')}
        </p>

        {!configured ? (
          <p data-testid="login-not-configured" className="text-destructive text-sm">
            {t('auth.login.notConfigured')}
          </p>
        ) : (
          <>
            <Button
              type="button"
              className="w-full"
              disabled={!sdkReady || busy || status === 'loading'}
              onClick={() => {
                void onSignIn();
              }}
              data-testid="login-button"
            >
              {busy ? t('auth.login.loading') : t('auth.login.button')}
            </Button>
            {!sdkReady && (
              <p className="text-muted-foreground mt-2 text-xs">{t('auth.login.sdkLoading')}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
