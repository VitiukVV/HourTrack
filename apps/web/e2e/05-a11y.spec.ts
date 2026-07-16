import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { seedAuthedSession } from './fixtures/auth';
import { waitForAppDb } from './fixtures/db';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * Accessibility audit. Runs axe-core against each of the four primary
 * authed routes and asserts ZERO critical violations. Serious + moderate
 * violations are reported as warnings (attached to the test info) but
 * do not block the run — color contrast edge cases inherited from the
 * shadcn defaults would otherwise produce noisy false positives.
 *
 * If a future tightening sweep wants stricter gates, change the
 * `disableRules` list rather than lowering the bar across all rules.
 */

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
        .disableRules(['region'])
        .analyze();

      const critical = results.violations.filter((v) => v.impact === 'critical');
      const seriousAndModerate = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'moderate',
      );

      if (seriousAndModerate.length > 0) {
        await testInfo.attach('a11y-warnings', {
          body: JSON.stringify(seriousAndModerate, null, 2),
          contentType: 'application/json',
        });
      }

      expect(
        critical,
        `Found ${critical.length} critical a11y violations on ${route.label}: ${critical
          .map((v) => v.id)
          .join(', ')}`,
      ).toHaveLength(0);
    });
  }
});
