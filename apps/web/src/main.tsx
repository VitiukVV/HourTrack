import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { loadInitialLocale } from '@/lib/i18n';
import '@/index.css';
import { App } from '@/App';
import { db, initDB } from '@/lib/db';
import { registerPwaUpdates } from '@/features/pwa/updatePrompt';
import { pruneTombstones } from '@/features/sync/pruneTombstones';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element "#root" not found in index.html');
}

// Open IndexedDB and seed default Settings on first launch. We deliberately
// fire-and-forget here: the UI does not depend on the seeded row to render,
// and an unhandled rejection during boot would already be visible in the
// console. Per-feature consumers should await `initDB(db)` themselves if
// they need the seeded row before first paint (S03+).

// Expired tombstones are dead weight: `lwwMerge` already refuses to carry them
// into a snapshot, but nothing removed them from Dexie, so the store grew by a
// row per deletion forever. Boot is the natural moment — it is off the render
// path and runs exactly once.
void initDB(db)
  .then(() => pruneTombstones(db))
  .catch((err: unknown) => {
    console.error('[hourtrack] initDB / tombstone prune failed:', err);
  });

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
}

void boot();
