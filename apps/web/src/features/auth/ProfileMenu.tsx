import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useAuth } from './authContext';

/**
 * Header profile menu trigger.
 *
 * S19 (UR-19-10 / Task 24): the avatar `<img>` / initials circle is replaced
 * with a plain `UserCircle` icon. No profile photo is displayed in the
 * chrome — the user explicitly asked to remove it. The popover content
 * (email, settings link, logout) is unchanged.
 *
 * Hides itself entirely when status is `anonymous` so the header doesn't
 * render a stale menu trigger pre-login. While `loading`, renders an
 * accessibility-friendly skeleton circle (no menu interactions yet).
 */
export function ProfileMenu() {
  const { t } = useTranslation();
  const { status, user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (
        menuRef.current &&
        target &&
        !menuRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (status === 'anonymous') {
    return null;
  }

  if (status === 'loading') {
    return (
      <div
        data-testid="profile-menu-skeleton"
        aria-hidden="true"
        className="border-border bg-muted h-8 w-8 animate-pulse rounded-full border"
      />
    );
  }

  const email = user?.email ?? '';
  const name = user?.name ?? '';

  return (
    <div className="relative" data-testid="profile-menu">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={email || t('auth.profileMenu.openLabel')}
        onClick={() => setOpen((v) => !v)}
        // S18 — `min-h-[44px] min-w-[44px]` on `< sm` for the iOS / Material
        // touch-target rule. Visual stays compact on desktop.
        // S19 — no photo background, just the icon on a neutral hover.
        className="text-muted-foreground hover:text-foreground hover:bg-accent flex h-9 min-h-[44px] w-9 min-w-[44px] items-center justify-center rounded-md transition-colors sm:min-h-0 sm:min-w-0"
      >
        <UserCircle className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('auth.profileMenu.openLabel')}
          className={cn(
            'border-border bg-popover text-popover-foreground absolute right-0 z-50 mt-1 min-w-[14rem] rounded-md border p-2 shadow-md',
          )}
        >
          {(name || email) && (
            <div className="px-2 pb-2">
              {name && <div className="text-sm font-medium">{name}</div>}
              {email && <div className="text-muted-foreground text-xs">{email}</div>}
            </div>
          )}
          <div className="border-border my-1 border-t" />
          <Link
            role="menuitem"
            to="/settings"
            onClick={() => setOpen(false)}
            className="hover:bg-accent hover:text-accent-foreground block rounded-sm px-2 py-1.5 text-sm"
          >
            {t('nav.settings')}
          </Link>
          <Button
            role="menuitem"
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            {t('auth.logout')}
          </Button>
        </div>
      )}
    </div>
  );
}
