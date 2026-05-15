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
    },
  }),
);
