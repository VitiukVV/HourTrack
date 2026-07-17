import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for HourTrack E2E tests.
 *
 * Test layout:
 *   - `e2e/` — golden-path specs + a11y audit
 *   - `e2e/fixtures/` — shared setup helpers (auth seeding, GIS mocking)
 *
 * Test server: Vite preview running the production build. This is closer
 * to real prod than `pnpm dev`, and lets us assert against the lazy-
 * loaded `/reports` chunk + the actual built bundle. The webServer block
 * boots `pnpm build && pnpm preview` automatically and reuses an already-
 * running server when present.
 *
 * Why not dev server: dev's HMR + on-the-fly transforms make E2E flakier
 * (modules can be partially evaluated mid-request) and don't represent
 * what users actually load. The Playwright suite is the deployment-gate
 * proxy; it must run against the same artefact that ships.
 *
 * Browser: chromium only. WebKit/Firefox would more than triple the run
 * time and the bugs are mostly Chromium-shaped (PWA, Web Crypto). If a
 * future bug surfaces only in Safari, add Webkit then.
 *
 * Output: `playwright-report/` for the HTML report; `test-results/` for
 * trace files. Both gitignored via the repo-wide `dist/` pattern (we
 * symlink output under there).
 */

export default defineConfig({
  testDir: './e2e',
  // Disable file-level parallelism for now — golden path tests share the
  // same IndexedDB key; running concurrently would race the seeded state.
  fullyParallel: false,
  workers: 1,
  // Fail loud on `.only` so CI never silently passes by running just one
  // test. S29 Task 18 wired the E2E job into `.github/workflows/ci.yml`, so
  // this gate is now live on every push/PR to main.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://localhost:4173',
    // 30s per action — enough headroom for the lazy-loaded /reports route
    // to download under load on a slow machine.
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Block the VitePWA service worker during E2E. Requests initiated by a
    // service worker bypass `page.route`, so an active SW lets real Google
    // API calls escape the mocks (surfaces as a 401 "invalid credentials"
    // backup-failed alert, and only on the slower mobile project where the
    // SW wins the registration race). These specs exercise app behaviour,
    // not PWA offline caching, so blocking the SW is both safe and the fix.
    serviceWorkers: 'block',
  },

  webServer: {
    // We build then `vite preview` against the dist/ artefact. Reusing the
    // server when present means `pnpm e2e` after a `pnpm dev` doesn't
    // re-build needlessly; specifying `reuseExistingServer: true` is the
    // pragmatic local-only choice.
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      // S18 — mobile viewport coverage. Runs the existing specs against an
      // iPhone 13 emulated profile so the mobile-polish + agenda view land
      // under e2e too. The same Chromium-shaped browser is used (mobile
      // Safari is the OS surface; for engine coverage WebKit would be a
      // separate project we deferred).
      //
      // To run mobile-only locally:
      //   pnpm -F web e2e --project=mobile-iphone-13
      //
      // See `e2e/README.md` for the full quickstart.
      name: 'mobile-iphone-13',
      use: {
        ...devices['iPhone 13'],
      },
    },
  ],
});
