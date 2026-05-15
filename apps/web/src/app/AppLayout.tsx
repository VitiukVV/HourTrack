import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { CardsHeader } from '@/features/cards/CardsHeader';
import { ProfileMenu } from '@/features/auth/ProfileMenu';
import { SyncIndicator } from '@/features/sync/SyncIndicator';
import { useAuth } from '@/features/auth/authContext';
import { OnboardingHost } from '@/features/onboarding/OnboardingHost';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  labelKey: 'nav.calendar' | 'nav.reports' | 'nav.settings';
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.calendar', end: true },
  { to: '/reports', labelKey: 'nav.reports' },
  { to: '/settings', labelKey: 'nav.settings' },
];

export function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const auth = useAuth();

  // CardsHeader sits below the primary nav and is only relevant on the
  // calendar/day/reports surfaces. Settings and login deliberately omit it.
  const showCardsHeader =
    location.pathname === '/' ||
    location.pathname.startsWith('/day/') ||
    location.pathname === '/reports';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border bg-background sticky top-0 z-20 border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <NavLink to="/" className="text-lg font-semibold tracking-tight" end>
            {t('app.title')}
          </NavLink>
          <nav aria-label="Primary" className="hidden gap-1 sm:flex">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {auth.status === 'authed' && <SyncIndicator />}
            <ProfileMenu />
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      {showCardsHeader && <CardsHeader />}

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <Outlet />
        </div>
      </main>

      <nav
        aria-label="Mobile primary"
        className="border-border bg-background sticky bottom-0 z-10 border-t sm:hidden"
      >
        <div className="mx-auto flex max-w-6xl">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex-1 px-3 py-3 text-center text-xs transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )
              }
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Onboarding tour host — renders the active step into a portal. Mounted
          inside AppLayout so the spotlight selectors (CardsHeader, DayCell)
          are already in the DOM by the time the tooltip positions itself. */}
      <OnboardingHost />
    </div>
  );
}
