import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import { queryClient } from '@/app/queryClient';
import { AppRouter } from '@/app/router';
import { ThemeManager } from '@/features/settings/useTheme';

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
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeManager />
      <AppRouter />
      <Toaster richColors closeButton position="top-right" />
    </QueryClientProvider>
  );
}
