import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { seedAuthedSession } from './fixtures/auth';
import { waitForAppDb } from './fixtures/db';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * Accessibility audit. Runs axe-core against each of the primary authed
 * routes and asserts ZERO `critical` AND ZERO `serious` violations (S29
 * Task 22 — the gate was `critical`-only before). `moderate` + `minor`
 * violations are still reported as warnings (attached to the test info) but
 * do not block the run.
 *
 * If a specific `serious` rule produces an unavoidable false positive
 * (e.g. a shadcn/Radix default we can't patch), disable THAT rule by id in
 * the `SERIOUS_RULE_EXCLUSIONS` list below with a comment citing why — never
 * lower the impact gate back to `critical`-only across all rules.
 */

// Per-rule serious-violation exclusions. Empty today; add `{ id, reason }`
// entries here rather than weakening the gate.
const SERIOUS_RULE_EXCLUSIONS: Array<{ id: string; reason: string }> = [];

const ROUTES_UNDER_AUDIT = [
  { path: '/', label: 'Home (Calendar)' },
  { path: '/day/2026-05-14', label: 'DayPage' },
  { path: '/reports', label: 'Reports' },
  { path: '/payments', label: 'Payments' },
  { path: '/settings', label: 'Settings' },
];

test.describe('A11y audit (axe-core)', () => {
  test.beforeEach(async ({ page }) => {
    await mockGisToken(page);
    await mockDriveApis(page, { existingFile: false });
    await mockCalendarApis(page);
    await page.goto('/login');
    await waitForAppDb(page);
    await seedAuthedSession(page, { onboardingSeen: true });
  });

  for (const route of ROUTES_UNDER_AUDIT) {
    test(`${route.label} has no critical violations`, async ({ page }, testInfo) => {
      await page.goto(route.path);

      // Wait for at least one stable indicator per route before scanning.
      // Routes that lazy-load (Reports) need explicit settling.
      if (route.path === '/reports') {
        await expect(page.getByTestId('reports-filters')).toBeVisible({ timeout: 15_000 });
      } else if (route.path === '/payments') {
        await expect(page.getByTestId('payments-header')).toBeVisible({ timeout: 15_000 });
      } else if (route.path === '/settings') {
        await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 10_000 });
      } else if (route.path.startsWith('/day/')) {
        await expect(page.getByTestId('day-page')).toBeVisible({ timeout: 10_000 });
      } else {
        await expect(page.getByTestId('cards-header')).toBeVisible({ timeout: 10_000 });
      }

      const results = await new AxeBuilder({ page })
        // Include only WCAG 2.1 AA rules — same gate the user-facing a11y
        // landscape converges on.
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // Onboarding portal can be off-screen on small viewports; we
        // disable region rules to avoid `region` violations from sonner's
        // toaster portal which sits outside main.
        .disableRules(['region', ...SERIOUS_RULE_EXCLUSIONS.map((r) => r.id)])
        .analyze();

      // S29 Task 22 — gate on critical AND serious.
      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      const nonBlocking = results.violations.filter(
        (v) => v.impact === 'moderate' || v.impact === 'minor',
      );

      if (nonBlocking.length > 0) {
        await testInfo.attach('a11y-warnings', {
          body: JSON.stringify(nonBlocking, null, 2),
          contentType: 'application/json',
        });
      }

      expect(
        blocking,
        `Found ${blocking.length} critical/serious a11y violations on ${route.label}: ${blocking
          .map((v) => `${v.id} (${v.impact})`)
          .join(', ')}`,
      ).toHaveLength(0);
    });
  }
});
