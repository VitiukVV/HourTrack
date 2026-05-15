import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useAuth } from './authContext';

/**
 * Header profile menu. Shows the Google avatar (or initials fallback when
 * `picture` is null) as a button; clicking opens a small popover with the
 * email, a link to Settings, and a Logout action.
 *
 * Hides itself entirely when status is `anonymous` so the header doesn't
 * render a stale avatar slot pre-login. While `loading`, renders an
 * accessibility-friendly skeleton circle (no avatar/menu interactions yet).
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
  const picture = user?.picture ?? null;
  const initials = (name || email).slice(0, 2).toUpperCase();

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
        // touch-target rule. Avatar visual stays 32px (h-8 w-8) — the
        // larger min-bounds expand the hit-target without resizing the
        // displayed image. Desktop keeps the compact size.
        className="border-border bg-background hover:bg-accent flex h-8 min-h-[44px] w-8 min-w-[44px] items-center justify-center overflow-hidden rounded-full border text-xs font-semibold sm:min-h-0 sm:min-w-0"
      >
        {picture ? (
          <img
            src={picture}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span aria-hidden="true">{initials || '?'}</span>
        )}
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
