import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import viteConfig from './vite.config';

// This config deliberately does NOT `mergeConfig` the whole app config the way
// it used to. Merging pulled every build-time plugin into the test run:
//
//   - VitePWA       -- service-worker + manifest generation; `devOptions` are
//                      off and vitest never builds an index.html, so it has
//                      nothing to do here.
//   - visualizer    -- a pure `generateBundle` hook (build-only by definition).
//   - tailwindcss   -- a CSS transform, dead here because `css: false` below
//                      means vitest never hands it a stylesheet.
//
// ...plus `build.rollupOptions.manualChunks` and the dev-server `port` /
// `strictPort` settings, none of which apply to a unit-test transform.
//
// Only the two things tests genuinely need are taken from the app config, by
// reference, so they can never drift out of sync with it:
//   - `define`  -- `__APP_VERSION__`, read by AboutSection.
//   - `resolve` -- the `@/*` and `@hourtrack/*` path aliases.
//
// `react()` stays: it owns the JSX transform for every .tsx under test.
export default defineConfig({
  define: viteConfig.define,
  resolve: viteConfig.resolve,
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Playwright owns the e2e/ directory. Without this exclude, vitest
    // would try to import the Playwright API and crash on `test` being
    // re-defined.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    css: false,
    // S29 Task 21 — real coverage (the v8 provider) with thresholds scoped
    // to the DATA-INTEGRITY CORE rather than a blanket app-wide number. A
    // regression that drops a branch in the sync / backup / lib layer (where
    // a bug silently corrupts or loses user data) fails CI; UI polish files
    // stay out of the gate so cosmetic churn doesn't red-wall PRs. This also
    // makes turbo.json's `outputs: ["coverage/**"]` declaration real.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/features/sync/**', 'src/features/backup/**', 'src/lib/**'],
      // Exclude type-only + barrel + generated files that have no runtime
      // branches to cover but would dilute the ratio.
      exclude: ['**/*.d.ts', '**/index.ts', 'src/lib/i18n/**'],
      // Thresholds sit a few points below the current observed ratios
      // (S29: stmts ~81%, branches ~70%, funcs ~83%, lines ~84%) so a real
      // regression trips the gate without red-walling on normal churn.
      thresholds: {
        lines: 78,
        functions: 78,
        statements: 78,
        branches: 68,
      },
    },
  },
});
