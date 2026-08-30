import { toast } from 'sonner';

import i18n from '@/lib/i18n';

import { usePwaUpdate } from './usePwaUpdate';

/**
 * Wire the service-worker update flow.
 *
 * `vite.config.ts` registers with `registerType: 'prompt'` on purpose: a new
 * build installs in the background but does NOT take over until asked, so a
 * half-written entry is never swept away by a reload the user did not ask for.
 * (The previous `autoUpdate` setting reloaded the page as soon as a deploy
 * landed — the accepted-but-unpleasant trade-off recorded in vite.config.ts.)
 *
 * The invitation is offered twice over, because a toast is a one-shot: it is
 * announced here AND recorded in `usePwaUpdate`, which Settings → "About"
 * reads for as long as the update is still waiting.
 *
 * Guarded so it is a no-op in dev / test: the `virtual:pwa-register` module
 * only resolves in a real build with the plugin active.
 */
export async function registerPwaUpdates(): Promise<void> {
  if (typeof window === 'undefined' || !import.meta.env.PROD) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        const apply = () => void updateSW(true);
        usePwaUpdate.getState().markWaiting(apply);
        toast(i18n.t('pwa.updated'), {
          description: i18n.t('pwa.updatedBody'),
          duration: Infinity,
          action: { label: i18n.t('pwa.reload'), onClick: apply },
        });
      },
      // Fires once, on the first visit that finishes precaching — the moment
      // the offline promise actually becomes true.
      onOfflineReady() {
        toast(i18n.t('pwa.offlineReady'), { description: i18n.t('pwa.offlineReadyBody') });
      },
    });
  } catch {
    // Virtual module unavailable (dev, or a browser without SW support) — the
    // app works without updates; nothing to do.
  }
}
