import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, initDB, updateSettings } from '@/lib/db';

import { useTheme, ThemeManager } from './useTheme';

let testDb: HourTrackDB;

type DbModule = typeof dbModule;

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<DbModule>();
  return {
    ...actual,
    get db() {
      return testDb;
    },
  };
});

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// Stash matchMedia mocks so each test can drive the system pref independently.
function installMatchMedia(initialDark: boolean) {
  let isDark = initialDark;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();

  const mql: Partial<MediaQueryList> & {
    _setDark: (next: boolean) => void;
    matches: boolean;
  } = {
    matches: isDark,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: ((type: string, listener: (e: MediaQueryListEvent) => void) => {
      if (type === 'change') listeners.add(listener);
    }) as MediaQueryList['addEventListener'],
    removeEventListener: ((type: string, listener: (e: MediaQueryListEvent) => void) => {
      if (type === 'change') listeners.delete(listener);
    }) as MediaQueryList['removeEventListener'],
    dispatchEvent: () => true,
    addListener: () => {},
    removeListener: () => {},
    _setDark(next: boolean) {
      isDark = next;
      (this as { matches: boolean }).matches = next;
      const evt = { matches: next } as MediaQueryListEvent;
      listeners.forEach((l) => l(evt));
    },
  };

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (_query: string) => mql,
  });

  return mql;
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-theme-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
  // Reset html class so prior tests don't leak.
  document.documentElement.classList.remove('dark');
});

afterEach(async () => {
  await testDb.delete();
  document.documentElement.classList.remove('dark');
});

describe('useTheme', () => {
  it('applies "dark" class on documentElement when theme=dark', async () => {
    installMatchMedia(false);
    await updateSettings(testDb, { theme: 'dark' });

    render(
      <Wrap>
        <ThemeManager />
      </Wrap>,
    );

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  it('does NOT apply "dark" class when theme=light', async () => {
    installMatchMedia(true);
    await updateSettings(testDb, { theme: 'light' });

    render(
      <Wrap>
        <ThemeManager />
      </Wrap>,
    );

    // theme=light wins over system preference
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  it('follows prefers-color-scheme when theme=system (initially dark)', async () => {
    installMatchMedia(true);
    await updateSettings(testDb, { theme: 'system' });

    render(
      <Wrap>
        <ThemeManager />
      </Wrap>,
    );

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  it('reacts to prefers-color-scheme changes when theme=system', async () => {
    const mql = installMatchMedia(false);
    await updateSettings(testDb, { theme: 'system' });

    render(
      <Wrap>
        <ThemeManager />
      </Wrap>,
    );

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    // Simulate OS pref flipping to dark.
    mql._setDark(true);

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  it('initial render mounts the correct class from persisted Settings', async () => {
    installMatchMedia(false);
    // Pre-set theme=dark in DB before mounting the manager.
    await updateSettings(testDb, { theme: 'dark' });

    render(
      <Wrap>
        <ThemeManager />
      </Wrap>,
    );

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });
});

describe('useTheme (return value)', () => {
  function HookProbe() {
    const theme = useTheme();
    return <span data-testid="resolved">{theme}</span>;
  }

  it('returns the resolved theme (dark for theme=dark)', async () => {
    installMatchMedia(false);
    await updateSettings(testDb, { theme: 'dark' });
    const { findByTestId } = render(
      <Wrap>
        <HookProbe />
      </Wrap>,
    );
    const span = await findByTestId('resolved');
    await waitFor(() => expect(span.textContent).toBe('dark'));
  });

  it('returns the resolved theme (light for system+light pref)', async () => {
    installMatchMedia(false);
    await updateSettings(testDb, { theme: 'system' });
    const { findByTestId } = render(
      <Wrap>
        <HookProbe />
      </Wrap>,
    );
    const span = await findByTestId('resolved');
    await waitFor(() => expect(span.textContent).toBe('light'));
  });
});
