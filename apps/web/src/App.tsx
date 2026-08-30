import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import { queryClient } from '@/app/queryClient';
import { AppRouter } from '@/app/router';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { DbInterruptedScreen } from '@/app/DbInterruptedScreen';
import { useDbStatus } from '@/lib/db/dbStatus';
import { ThemeManager, useTheme } from '@/features/settings/useTheme';

/**
 * Toaster wrapper that follows the resolved app theme. Sonner defaults to
 * `theme="light"`, so in dark mode the toasts would render as bright white
 * cards against the dark UI. `useTheme()` resolves `Settings.theme`
 * (including `'system'`) to a concrete `'light' | 'dark'`; mounting this
 * inside the `QueryClientProvider` is required because the hook reads
 * settings via TanStack Query.
 */
function ThemedToaster() {
  const theme = useTheme();
  return <Toaster richColors closeButton position="top-right" theme={theme} />;
}

/**
 * App root. Mounts the router, the global `<Toaster />` (sonner — surfaces
 * success/error messages from any feature mutation), and the `ThemeManager`
 * (toggles the `dark` class on `<html>` based on `Settings.theme`).
 *
 * ThemeManager mounts OUTSIDE the router (so route transitions don't
 * unmount it and cause a brief flash of the wrong theme) but INSIDE the
 * shared `<QueryClientProvider>` — `ThemeManager` uses `useSettingsQuery`
 * under the hood, and TanStack Query v5 throws "No QueryClient set" if
 * the hook resolves before the provider is mounted. The provider used to
 * live inside `<AppRouter />`; lifting it here was the S13 fix that
 * unblocked the production preview build.
 *
 * Single named export per S01 followup — drop the dual default/named export.
 */
export function App() {
  // A closed/blocked IndexedDB connection makes every query hang forever, so
  // the routed tree would render a permanently "loading" app. Swap in the
  // explanation instead — see `lib/db/dbStatus.ts`.
  const interruption = useDbStatus((s) => s.interruption);

  return (
    <QueryClientProvider client={queryClient}>
      {/* S29 Task 10 — top-level boundary so a render crash shows the localized
          recovery screen (with Reload) instead of a blank installed-PWA page.
          Kept inside the QueryClientProvider so ErrorScreen's hooks resolve. */}
      <ErrorBoundary>
        <ThemeManager />
        {interruption ? <DbInterruptedScreen reason={interruption} /> : <AppRouter />}
        <ThemedToaster />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
