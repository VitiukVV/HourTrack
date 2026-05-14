import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import '@/lib/i18n';

import { BackupErrorBanner } from './BackupErrorBanner';

describe('BackupErrorBanner', () => {
  it('renders nothing when error is null', () => {
    const { container } = render(<BackupErrorBanner error={null} onRetry={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the error message + retry button when error is set', () => {
    render(<BackupErrorBanner error="Quota exceeded" onRetry={() => undefined} />);
    expect(screen.getByTestId('backup-error-banner')).toBeInTheDocument();
    expect(screen.getByText(/Quota exceeded/)).toBeInTheDocument();
    expect(screen.getByTestId('backup-error-banner-retry')).toBeInTheDocument();
  });

  it('disables the retry button while busy', () => {
    render(<BackupErrorBanner error="boom" onRetry={() => undefined} busy />);
    expect(screen.getByTestId('backup-error-banner-retry')).toBeDisabled();
  });

  it('invokes onRetry when the retry button is clicked', async () => {
    const onRetry = vi.fn();
    render(<BackupErrorBanner error="boom" onRetry={onRetry} />);
    await userEvent.click(screen.getByTestId('backup-error-banner-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
