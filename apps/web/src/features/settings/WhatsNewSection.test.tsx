import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import { WhatsNewSection } from './WhatsNewSection';

const mockUseWhatsNewSeen = vi.fn();
vi.mock('@/features/whats-new/useWhatsNewSeen', () => ({
  useWhatsNewSeen: () => mockUseWhatsNewSeen(),
}));

function renderSection() {
  return render(
    <MemoryRouter>
      <WhatsNewSection />
    </MemoryRouter>,
  );
}

describe('WhatsNewSection', () => {
  it('renders a link to /whats-new', async () => {
    mockUseWhatsNewSeen.mockReturnValue({ hasUnseen: false, markSeen: vi.fn() });
    renderSection();

    expect(await screen.findByTestId('settings-whats-new')).toBeInTheDocument();
    const link = screen.getByTestId('settings-whats-new-link');
    expect(link).toHaveAttribute('href', '/whats-new');
  });

  it('shows the "New" badge when there is an unseen release', async () => {
    mockUseWhatsNewSeen.mockReturnValue({ hasUnseen: true, markSeen: vi.fn() });
    renderSection();

    expect(await screen.findByTestId('settings-whats-new-badge')).toBeInTheDocument();
  });

  it('hides the badge once the latest release has been seen', async () => {
    mockUseWhatsNewSeen.mockReturnValue({ hasUnseen: false, markSeen: vi.fn() });
    renderSection();

    await screen.findByTestId('settings-whats-new');
    expect(screen.queryByTestId('settings-whats-new-badge')).not.toBeInTheDocument();
  });
});
