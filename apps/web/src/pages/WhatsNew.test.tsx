import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import { CHANGELOG_RELEASES } from '@/features/whats-new/changelog';

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
});
