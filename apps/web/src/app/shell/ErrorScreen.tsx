import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

/**
 * S29 Task 10 (UR-29-5) — localized "something broke" recovery screen. Shown
 * by the root ErrorBoundary and by the router's `errorElement`. The installed
 * PWA has no browser chrome (no address bar / reload button), so a render-time
 * crash would otherwise strand the user on a permanent white screen with no
 * way out. The Reload button gives them one.
 *
 * `useTranslation` reads the global i18next instance (initialized in
 * `@/lib/i18n`), which works even when this renders from an error boundary
 * outside the normal tree. Each key carries an English `defaultValue` so the
 * screen still reads sensibly if the crash was i18n-related.
 */
export function ErrorScreen() {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-testid="error-screen"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <h1 className="text-xl font-semibold">{t('errorBoundary.title', 'Something went wrong')}</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        {t('errorBoundary.body', 'The app hit an unexpected error. Reloading usually fixes it.')}
      </p>
      <Button onClick={() => window.location.reload()} data-testid="error-screen-reload">
        {t('errorBoundary.reload', 'Reload')}
      </Button>
    </div>
  );
}
