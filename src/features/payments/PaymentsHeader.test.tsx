import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/lib/i18n/i18n';

import { PaymentsHeader } from './PaymentsHeader';

describe('PaymentsHeader', () => {
  // Spec 012 FR-001 — month switcher + totals stay pinned under the app chrome.
  it('is a pinned bar under the measured chrome, opaque so rows pass beneath it', () => {
    render(<PaymentsHeader totals={undefined} />);
    const header = screen.getByTestId('payments-header');
    expect(header.className).toMatch(/\bsticky\b/);
    expect(header.className).toContain('top-[var(--ht-sticky-chrome,0px)]');
    expect(header.className).toContain('bg-background');
    expect(header.className).toMatch(/\bz-10\b/);
  });

  it('holds both the month navigation and the totals strip', () => {
    render(<PaymentsHeader totals={{ expected: 250, received: 200, outstanding: 50 }} />);
    const header = screen.getByTestId('payments-header');
    expect(header).toContainElement(screen.getByTestId('payments-next-month'));
    expect(header).toContainElement(screen.getByTestId('payments-rollup'));
  });
});
