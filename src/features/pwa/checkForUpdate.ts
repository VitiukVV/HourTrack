import { usePwaUpdate } from './usePwaUpdate';

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
/**
 * A check was asked for before the registration arrived (the session's first
 * pull can beat `onRegisteredSW`). It runs as soon as the registration is set.
 */
let checkPending = false;

/** Called by `registerPwaUpdates` once the service worker is registered. */
export function setServiceWorkerRegistration(reg: ServiceWorkerRegistration | undefined): void {
  registration = reg;
  if (reg && checkPending) {
    checkPending = false;
    checkForUpdate();
  }
}

/**
 * Ask the service worker to look for a new build. A found build goes through
 * the normal `onNeedRefresh` invitation. Without a registration yet the check
 * is remembered and runs once one is set (never in dev / tests / browsers
 * without SW support). Never throws.
 */
export function checkForUpdate(): void {
  if (!registration) {
    checkPending = true;
    return;
  }
  registration.update().catch((err: unknown) => {
    console.warn('[pwa] update check failed:', err);
  });
}

/**
 * The action behind "Reload" on the update-required toast: switch to the new
 * build when one is waiting, otherwise reload (which also lets the browser
 * pick up a build that finished installing meanwhile).
 */
export function applyUpdateOrReload(): void {
  const { waiting, apply } = usePwaUpdate.getState();
  if (waiting) apply();
  else window.location.reload();
}

/** Test-only — forget the registration and any pending check. */
export function _resetCheckForUpdateForTesting(): void {
  registration = undefined;
  checkPending = false;
}
