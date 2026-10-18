import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { loadInitialLocale } from '@/lib/i18n/i18n';
import '@/index.css';
import { App } from '@/App';
import { installUnhandledRejectionToast } from '@/app/shell/unhandledRejectionToast';
import { db } from '@/lib/db';
import { openDatabaseAtBoot } from '@/lib/db/openAtBoot';
import { registerPwaUpdates } from '@/features/pwa/updatePrompt';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element "#root" not found in index.html');
}

// Open IndexedDB (see `openDatabaseAtBoot`): the UI does not wait for it, and a
// failed open swaps in the DB-interrupted screen.
void openDatabaseAtBoot(db);

// Service-worker registration + update prompt. Fire-and-forget and a no-op
// outside a production build.
void registerPwaUpdates();

// S23 — locale bundles are dynamically imported (one chunk per language).
// Await the initial locale so first render finds populated translations;
// otherwise a brief flash of literal keys (e.g. "common.loading") paints
// before i18next's async load resolves.
//
// We don't fail boot if the locale fetch errors: `partialBundledLanguages`
// + i18next's key-fallback means the UI still renders, just with the
// English key strings until the network catches up.
async function boot() {
  try {
    await loadInitialLocale();
  } catch (err) {
    console.warn('[hourtrack] loadInitialLocale failed; rendering with fallback:', err);
  }
  createRoot(rootEl!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // Spec 007: a rejection nobody handled is logged AND told to the user —
  // installed once the <Toaster> exists, with translations loaded.
  installUnhandledRejectionToast();
}

void boot();
