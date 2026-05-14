import { useEffect, useState } from 'react';

import type { Theme } from '@hourtrack/shared-types';

import { useSettingsQuery } from './useSettings';

/**
 * Resolves `Settings.theme` (which may be `'system'`) to a concrete
 * `'light' | 'dark'` value, taking into account the OS-level
 * `prefers-color-scheme` media query when the user has chosen "System".
 *
 * Subscribes to `matchMedia('(prefers-color-scheme: dark)').change` when
 * (and ONLY when) the resolved mode is `'system'`. The listener is cleaned
 * up on unmount or when the user picks an explicit light/dark mode, so the
 * browser doesn't leak a forever-listener.
 *
 * Returns the resolved theme (`'light' | 'dark'`). `ThemeManager` consumes
 * this hook and toggles the `dark` class on `<html>`; components rarely need
 * to call this hook themselves.
 */

type Resolved = 'light' | 'dark';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

function getSystemPref(): Resolved {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function useTheme(): Resolved {
  const settingsQuery = useSettingsQuery();
  const setting: Theme = settingsQuery.data?.theme ?? 'system';

  // Hold the OS-level pref in state so we can react to live changes.
  const [systemPref, setSystemPref] = useState<Resolved>(() => getSystemPref());

  useEffect(() => {
    if (setting !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mql = window.matchMedia(DARK_MEDIA_QUERY);
    // Initial sync (in case the pref changed before this effect attached).
    setSystemPref(mql.matches ? 'dark' : 'light');

    const handler = (e: MediaQueryListEvent) => setSystemPref(e.matches ? 'dark' : 'light');
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [setting]);

  if (setting === 'system') return systemPref;
  return setting;
}

/**
 * Mount once at the App root. Reads `Settings.theme` via `useTheme()` and
 * toggles the `dark` class on `<html>`. Tailwind's `darkMode: 'class'`
 * convention (the v4 default for the `dark:` variant) keys off this exact
 * class. No render output — purely an effect carrier.
 */
export function ThemeManager(): null {
  const resolved = useTheme();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [resolved]);

  return null;
}
