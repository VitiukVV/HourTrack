import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// Surface the app's package.json `version` to runtime code as a `define` so
// `AboutSection` can render the live build number without having to import
// the JSON at runtime (which Vite would then bundle in full, including
// dependencies).
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf8')) as {
  version: string;
};

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // S13 introduced manualChunks to split heavy vendor libs out of the
    // home-route bundle. S15 removed Recharts entirely — the `charts` chunk
    // that previously held it (and its d3 transitives) is gone. The
    // remaining splits (dexie, date-fns, radix) still pay for themselves
    // because both `/` and `/reports` import them.
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('dexie')) return 'dexie';
            if (id.includes('date-fns')) return 'date-fns';
            if (id.includes('@radix-ui')) return 'radix';
            // Everything else stays in the default vendor split.
            // IMPORTANT: do NOT split TanStack into its own chunk. The
            // QueryClient identity is a module-level singleton; if a
            // lazy route resolves `@tanstack/react-query` from a
            // different module instance the provider's `useQueryClient`
            // returns null and React Query throws "No QueryClient
            // set". Keeping it in the default chunk forces both the
            // eager and lazy entry points to share a single instance.
          }
          return undefined;
        },
      },
    },
    // Keep the chunk-size warning at its sensible default; downgrading to
    // silence noise would mask real regressions. Post-S15 (Recharts gone)
    // the main bundle drops well under the warning threshold.
    chunkSizeWarningLimit: 600,
  },
  plugins: [
    react(),
    tailwindcss(),
    // S13: emit a treemap report at `dist/stats.html` on every build so
    // the developer can audit bundle size locally. Skipped during dev
    // (no Vite build), and the output file is gitignored separately.
    visualizer({
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
      // Don't auto-open the report in CI; the file is on disk for whoever
      // wants to inspect it locally via `pnpm preview` or a manual open.
      open: false,
    }),
    VitePWA({
      // S31 (Task 19) — DECISION: keep `autoUpdate` (accepted trade-off).
      // On a new deploy the service worker takes over and reloads the page,
      // which can drop unsaved input mid-edit (EntryEditor / CardForm). For a
      // single-user personal tool with infrequent, user-controlled deploys the
      // reload window is tiny and the always-fresh guarantee is worth more than
      // guarding a rare mid-edit reload. A `registerType: 'prompt'` + a
      // localized "New version — reload" affordance is filed as backlog
      // (docs/PERF_NOTES.md) if the drop-input case ever bites in practice.
      registerType: 'autoUpdate',
      devOptions: {
        enabled: false,
      },
      injectRegister: 'auto',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'HourTrack',
        short_name: 'HourTrack',
        description: 'Personal work hours tracker with Google Drive sync',
        theme_color: '#0F172A',
        background_color: '#0F172A',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'uk',
        icons: [
          {
            src: '/icons/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        // S01 note (per spec): do NOT aggressively cache data.json -- that path is
        // owned by SyncManager (S10), not Workbox runtime caching.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@hourtrack/shared-types': path.resolve(
        __dirname,
        '../../packages/shared-types/src/index.ts',
      ),
      '@hourtrack/shared-utils': path.resolve(
        __dirname,
        '../../packages/shared-utils/src/index.ts',
      ),
    },
  },
  server: {
    port: 5173,
    // Fail loudly if 5173 is taken instead of silently drifting to 5174+.
    // Google OAuth rejects any origin not in the Cloud Console "Authorized
    // JavaScript origins" list; only http://localhost:5173 is registered, so
    // a drifting port surfaces as a 400 origin_mismatch. Keeping the port
    // fixed guarantees the dev origin always matches what Google expects.
    strictPort: true,
  },
});
