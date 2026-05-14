import { Toaster } from 'sonner';

import { AppRouter } from '@/app/router';
import { ThemeManager } from '@/features/settings/useTheme';

/**
 * App root. Mounts the router, the global `<Toaster />` (sonner — surfaces
 * success/error messages from any feature mutation), and the `ThemeManager`
 * (toggles the `dark` class on `<html>` based on `Settings.theme`).
 *
 * ThemeManager mounts OUTSIDE the router so it isn't unmounted on route
 * transitions; that would briefly reset the html class and cause a flash.
 *
 * Single named export per S01 followup — drop the dual default/named export.
 */
export function App() {
  return (
    <>
      <ThemeManager />
      <AppRouter />
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}
