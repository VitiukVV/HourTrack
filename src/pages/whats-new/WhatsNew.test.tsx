import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import i18n from '@/lib/i18n/i18n';

import { CHANGELOG_RELEASES } from '@/features/whats-new/changelog';
import { GUIDE_SECTIONS } from '@/features/whats-new/guide';

import { WhatsNewPage } from './WhatsNew';

const markSeen = vi.fn();
vi.mock('@/features/whats-new/useWhatsNewSeen', () => ({
  useWhatsNewSeen: () => ({ hasUnseen: true, markSeen }),
}));

describe('WhatsNewPage', () => {
  it('renders one row per changelog release', async () => {
    render(
      <MemoryRouter>
        <WhatsNewPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('whats-new-page')).toBeInTheDocument();
    const rows = screen.getAllByTestId('whats-new-release');
    expect(rows).toHaveLength(CHANGELOG_RELEASES.length);
    expect(rows[0]).toHaveTextContent(CHANGELOG_RELEASES[0]!.version);
  });

  it('marks the changelog as seen on mount', async () => {
    render(
      <MemoryRouter>
        <WhatsNewPage />
      </MemoryRouter>,
    );

    await screen.findByTestId('whats-new-page');
    expect(markSeen).toHaveBeenCalled();
  });

  it('scrolls the window to the top on mount', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    render(
      <MemoryRouter>
        <WhatsNewPage />
      </MemoryRouter>,
    );

    await screen.findByTestId('whats-new-page');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    scrollTo.mockRestore();
  });

  it('opens with the capabilities block above the releases, every section collapsed', async () => {
    await i18n.changeLanguage('uk');
    render(
      <MemoryRouter>
        <WhatsNewPage />
      </MemoryRouter>,
    );
    const guide = await screen.findByTestId('whats-new-guide');
    expect(guide).toHaveTextContent('Можливості');
    const toggles = within(guide).getAllByRole('button');
    expect(toggles).toHaveLength(GUIDE_SECTIONS.length);
    for (const toggle of toggles) expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // The guide comes first on the page.
    const releases = screen.getAllByTestId('whats-new-release')[0]!;
    expect(guide.compareDocumentPosition(releases) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a tapped section shows how that part of the app works', async () => {
    await i18n.changeLanguage('uk');
    render(
      <MemoryRouter>
        <WhatsNewPage />
      </MemoryRouter>,
    );
    const guide = await screen.findByTestId('whats-new-guide');
    const payments = within(guide).getByRole('button', { name: /оплати/i });
    await userEvent.click(payments);
    expect(payments).toHaveAttribute('aria-expanded', 'true');
    expect(guide).toHaveTextContent(/розрах/i);
  });
});
