import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';
import { usePwaUpdate } from '@/features/pwa/usePwaUpdate';

import { AboutSection } from './AboutSection';

/**
 * The update row is the half of the SW-update prompt that survives a dismissed
 * toast: `registerType: 'prompt'` leaves the new build waiting, and in an
 * installed PWA "close every tab" is not a thing the user does.
 */
afterEach(() => {
  usePwaUpdate.setState({ waiting: false, apply: () => {} });
});

describe('AboutSection', () => {
  it('reports the app as up to date when no build is waiting', () => {
    render(<AboutSection />);
    expect(screen.getByTestId('settings-about-update-status')).toHaveTextContent(/latest version/i);
    expect(screen.queryByTestId('settings-about-update-apply')).not.toBeInTheDocument();
  });

  it('offers the waiting update and applies it on click', async () => {
    const apply = vi.fn();
    usePwaUpdate.getState().markWaiting(apply);

    const user = userEvent.setup();
    render(<AboutSection />);

    expect(screen.getByTestId('settings-about-update-status')).toHaveTextContent(/new version/i);
    await user.click(screen.getByTestId('settings-about-update-apply'));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('still renders a version string outside a real build', () => {
    render(<AboutSection />);
    expect(screen.getByTestId('settings-about-version')).toHaveTextContent(/\S/);
  });
});
