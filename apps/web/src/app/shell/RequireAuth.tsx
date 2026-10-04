import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/authContext';

/**
 * Route guard. Wraps protected sections of the app (`/`, `/day/:date`,
 * `/reports`, `/settings`).
 *
 * Behavior:
 *   - `loading`     -- render a centered spinner placeholder so the layout
 *                      doesn't briefly flash an empty page or redirect
 *                      pre-emptively before the Dexie read completes.
 *   - `anonymous`   -- redirect to `/login`, preserving the attempted path
 *                      via state so post-login redirect can return there.
 *   - `authed`      -- render the protected children via `<Outlet />`.
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (status === 'loading') {
    return (
      <div
        data-testid="require-auth-loading"
        className="flex min-h-dvh items-center justify-center"
      >
        <span className="text-muted-foreground text-sm">{t('common.loading')}</span>
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
}
