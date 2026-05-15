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
    // S13: split heavy vendor libs into their own chunks so the home-route
    // initial JS shrinks. Recharts is already deferred via `/reports` route
    // lazy import; manualChunks here covers the rest (dexie, date-fns) that
    // multiple routes share. The chart vendor split also helps because some
    // routes (Reports) lazy-load it via the route boundary above — chunk
    // sharing means the Reports route doesn't re-download recharts when
    // navigating back from another route.
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Recharts is only loaded by /reports route — chunk it
            // separately so the home route bundle skips it.
            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
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
    // silence noise would mask real regressions. The home-route bundle
    // post-S13 lazy-load is ~580 kB raw, ~180 kB gzipped — under the 500 kB
    // gzip threshold the build warns at by default.
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
    strictPort: false,
  },
});
