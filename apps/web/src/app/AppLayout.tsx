import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { CardsHeader } from '@/features/cards/CardsHeader';
import { OnboardingHost } from '@/features/onboarding/OnboardingHost';
import { DueRemindersBanner } from '@/features/reminders/DueRemindersBanner';
import { ReminderBell } from '@/features/reminders/ReminderBell';
import { RemindersScheduler } from '@/features/reminders/RemindersScheduler';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  labelKey: 'nav.calendar' | 'nav.reports' | 'nav.payments' | 'nav.settings';
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.calendar', end: true },
  { to: '/reports', labelKey: 'nav.reports' },
  { to: '/payments', labelKey: 'nav.payments' },
  { to: '/settings', labelKey: 'nav.settings' },
];

/**
 * The ProfileMenu used to live in the right cluster (sign-out + email
 * surface). Per user request it was removed — Settings (which holds the
 * sign-out flow) is reachable via the primary nav, and the right cluster
 * is now LanguageSwitcher-only.
 *
 * S19 (UR-19-11 / Tasks 25-26): bottom nav stays `sm:hidden` (mobile/tablet
 * only — desktop uses the top nav). Active route is signalled by a primary-
 * color top border + slight bg tint; inactive routes carry a transparent
 * border of the same width so switching routes doesn't cause a 2px layout
 * shift.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();

  // CardsHeader sits below the primary nav and is only relevant on the
  // calendar/day surfaces (where the user picks an "active" card for
  // day-click create). Reports does NOT use active-card semantics — it has
  // its own multi-select chip row inside ReportsFilters (S20 UR-20-2 /
  // Task 14). Settings and login deliberately omit the header too.
  const showCardsHeader = location.pathname === '/' || location.pathname.startsWith('/day/');

  return (
    <div className="flex min-h-dvh flex-col">
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
            <ReminderBell />
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      {showCardsHeader && <CardsHeader />}

      <div className="px-4">
        <DueRemindersBanner />
      </div>

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <Outlet />
        </div>
      </main>

      <nav
        aria-label="Mobile primary"
        data-testid="bottom-nav"
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
                  // S19 (UR-19-11 / Task 26) — primary-color top border on
                  // active route + 5% bg tint signals position at a glance.
                  // Inactive routes carry a transparent border of the same
                  // width so the layout doesn't shift on route change.
                  // S18 — `min-h-[44px]` enforces iOS / Material touch
                  // target on the mobile-only bottom nav.
                  'flex min-h-[44px] flex-1 items-center justify-center border-t-2 px-3 py-3 text-center text-xs transition-colors',
                  isActive
                    ? 'border-primary bg-primary/5 text-foreground font-medium'
                    : 'text-muted-foreground border-transparent',
                )
              }
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* S28 — mount-once scheduler that toasts reminders crossing due while
          the app is open. Invisible; renders nothing. */}
      <RemindersScheduler />

      {/* Onboarding tour host — renders the active step into a portal. Mounted
          inside AppLayout so the spotlight selectors (CardsHeader, DayCell)
          are already in the DOM by the time the tooltip positions itself. */}
      <OnboardingHost />
    </div>
  );
}
