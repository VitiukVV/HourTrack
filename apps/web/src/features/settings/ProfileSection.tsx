import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/authContext';

import { SettingsSection } from './SettingsSection';

/**
 * Profile section (S09). Replaces the S08 placeholder.
 *
 *   - Anonymous: shows "Not signed in" + Sign-in button that navigates to
 *     `/login`. (RequireAuth normally prevents this state from being
 *     reachable on `/settings`, but we still render a defensive copy in case
 *     a future code path mounts Settings while anonymous — e.g. a public
 *     "About this app" surface.)
 *   - Authed: avatar + name + email + Logout button. Logout calls
 *     `AuthProvider.signOut()` which revokes the token, clears Dexie tokens,
 *     and invalidates protected queries. Then redirects to `/login`.
 */
export function ProfileSection() {
  const { t } = useTranslation();
  const { status, user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async (): Promise<void> => {
    try {
      await signOut();
      toast.success(t('auth.logoutSuccess'));
      navigate('/login', { replace: true });
    } catch (err) {
      console.warn('[ProfileSection] signOut failed', err);
      toast.error(t('auth.logoutError'));
    }
  };

  if (status !== 'authed' || !user) {
    return (
      <SettingsSection
        title={t('settings.profile.title')}
        testId="settings-profile"
        subtitle={t('settings.profile.subtitle')}
      >
        <p className="text-sm" data-testid="settings-profile-status">
          {t('settings.profile.notLoggedIn')}
        </p>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => navigate('/login')}>
            {t('auth.login.button')}
          </Button>
        </div>
      </SettingsSection>
    );
  }

  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();
  return (
    <SettingsSection
      title={t('settings.profile.title')}
      testId="settings-profile"
      subtitle={t('settings.profile.subtitle')}
    >
      <div className="flex items-center gap-3" data-testid="settings-profile-status">
        <div className="border-border bg-muted flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border">
          {user.picture ? (
            <img
              src={user.picture}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              data-testid="settings-profile-avatar"
            />
          ) : (
            <span className="text-sm font-semibold" aria-hidden="true">
              {initials || '?'}
            </span>
          )}
        </div>
        {/* `min-w-0` is the standard flex-truncation unlock — without it the
            child's intrinsic content width wins and a long email pushes
            the row past 375px. Combined with `truncate` on the email span
            this guarantees the row fits on iPhone SE-class viewports. */}
        <div className="flex min-w-0 flex-col">
          {user.name && (
            <span className="truncate text-sm font-medium" data-testid="settings-profile-name">
              {user.name}
            </span>
          )}
          <span
            className="text-muted-foreground truncate text-xs"
            data-testid="settings-profile-email"
          >
            {user.email}
          </span>
        </div>
      </div>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void handleLogout();
          }}
          data-testid="settings-profile-logout"
        >
          {t('settings.profile.logout')}
        </Button>
      </div>
    </SettingsSection>
  );
}
