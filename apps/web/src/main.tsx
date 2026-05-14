import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/lib/i18n';
import '@/index.css';
import { App } from '@/App';
import { db, initDB } from '@/lib/db';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element "#root" not found in index.html');
}

// Open IndexedDB and seed default Settings on first launch. We deliberately
// fire-and-forget here: the UI does not depend on the seeded row to render,
// and an unhandled rejection during boot would already be visible in the
// console. Per-feature consumers should await `initDB(db)` themselves if
// they need the seeded row before first paint (S03+).
void initDB(db).catch((err: unknown) => {
  console.error('[hourtrack] initDB failed:', err);
});

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
