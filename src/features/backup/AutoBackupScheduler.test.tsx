import { render, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue } from '@/features/auth/authContext';
import { withFreshToken } from '@/lib/google/authorizedCall';

import { AutoBackupScheduler } from './AutoBackupScheduler';
import { runAutoBackupIfDue, type AutoBackupResult } from './autoBackup';

let auth: Pick<AuthContextValue, 'status' | 'tokens'>;
vi.mock('@/features/auth/authContext', () => ({ useAuth: () => auth }));
vi.mock('./autoBackup', () => ({ runAutoBackupIfDue: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function signIn(accessToken: string): void {
  auth = {
    status: 'authed',
    tokens: { accessToken, scope: 'drive' } as AuthContextValue['tokens'],
  };
}

function nextResult(result: AutoBackupResult): void {
  vi.mocked(runAutoBackupIfDue).mockResolvedValueOnce(result);
}

beforeEach(() => {
  signIn('AT');
  vi.mocked(runAutoBackupIfDue).mockResolvedValue({ outcome: 'skipped-not-due' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AutoBackupScheduler', () => {
  it('renews the sign-in for each run (withFreshToken), not only the context token', async () => {
    render(<AutoBackupScheduler />);
    await waitFor(() => expect(runAutoBackupIfDue).toHaveBeenCalledTimes(1));
    expect(vi.mocked(runAutoBackupIfDue).mock.calls[0]![0].withToken).toBe(withFreshToken);
  });

  it('tells the user when an automatic backup failed, once per session', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    nextResult({ outcome: 'failed', error: 'Drive API error 500' });
    const { rerender } = render(<AutoBackupScheduler />);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('backup.autoBackupFailed', {
        id: 'backup-auto-failed',
      }),
    );

    // A new token (silent renewal) re-checks; another failure stays quiet.
    nextResult({ outcome: 'failed', error: 'Drive API error 500' });
    signIn('AT-2');
    rerender(<AutoBackupScheduler />);
    await waitFor(() => expect(runAutoBackupIfDue).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for every outcome but failed', async () => {
    nextResult({ outcome: 'created' });
    render(<AutoBackupScheduler />);
    await waitFor(() => expect(runAutoBackupIfDue).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
