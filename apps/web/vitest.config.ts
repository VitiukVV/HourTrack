import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
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
  }),
);
