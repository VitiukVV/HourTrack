import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/lib/i18n';

import { LanguageSwitcher } from './LanguageSwitcher';

/**
 * S20 Task 22 — verify the LanguageSwitcher trigger meets the mobile touch-
 * target rule and the Spanish label fits. These are class-level assertions
 * (jsdom/happy-dom doesn't run CSS layout / matchMedia by default), so we
 * assert the source-of-truth Tailwind utility names rather than computed
 * geometry.
 */

function renderSwitcher() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageSwitcher />
    </QueryClientProvider>,
  );
}

describe('LanguageSwitcher', () => {
  it('trigger carries the mobile touch-target classes (min-h-[44px] on <sm, sm:h-8)', () => {
    renderSwitcher();
    const trigger = screen.getByTestId('language-switcher');
    // Mobile-first: 44px minimum.
    expect(trigger.className).toMatch(/min-h-\[44px\]/);
    // Tablet+: collapse back to the compact 32px Select height.
    expect(trigger.className).toMatch(/sm:h-8/);
  });

  it('trigger is widened to w-[8rem] so the Spanish label "Español" fits', () => {
    renderSwitcher();
    const trigger = screen.getByTestId('language-switcher');
    expect(trigger.className).toMatch(/w-\[8rem\]/);
  });

  it('renders an aria-label for the trigger (accessibility)', () => {
    renderSwitcher();
    const trigger = screen.getByTestId('language-switcher');
    // i18n in the vitest env falls back to en — the key is `common.language`
    // → "Language".
    expect(trigger.getAttribute('aria-label')).toBe('Language');
  });
});
