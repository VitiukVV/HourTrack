/**
 * On-demand service-worker update check (spec 016 FR-008: the shared data was
 * written by a newer app, so this one should update now rather than at the
 * browser's next scheduled check).
 *
 * Kept apart from `updatePrompt.ts` on purpose: that module imports
 * `virtual:pwa-register`, which only resolves in a build with the PWA plugin,
 * so anything importing it breaks every test that renders the app tree.
 */

let registration: ServiceWorkerRegistration | undefined;

/** Called by `registerPwaUpdates` once the service worker is registered. */
export function setServiceWorkerRegistration(reg: ServiceWorkerRegistration | undefined): void {
  registration = reg;
}

/**
 * Ask the service worker to look for a new build. A found build goes through
 * the normal `onNeedRefresh` invitation. A no-op without a registration (dev,
 * tests, no SW support); never throws.
 */
export function checkForUpdate(): void {
  if (!registration) return;
  registration.update().catch((err: unknown) => {
    console.warn('[pwa] update check failed:', err);
  });
}
