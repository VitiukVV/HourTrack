import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue } from '@/features/auth/authContext';

import { ResyncModal } from './ResyncModal';
import { runResyncAll } from './resyncAll';

// The auth context holds a STALE token; the real `withFreshToken` must hand
// the run the renewed one.
vi.mock('@/features/auth/authContext', () => ({
  useAuth: (): Pick<AuthContextValue, 'tokens'> => ({
    tokens: { accessToken: 'STALE' } as AuthContextValue['tokens'],
  }),
}));
vi.mock('@/lib/google/tokenRefresh', () => ({
  getFreshAccessToken: vi.fn(async () => 'FRESH'),
  forceRenewAccessToken: vi.fn(async () => null),
}));
vi.mock('./resyncAll', () => ({
  runResyncAll: vi.fn(async () => ({ succeeded: 0, failed: 0, total: 0 })),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(() => {
  vi.clearAllMocks();
});

describe('ResyncModal (spec 016 review B3)', () => {
  it('runs the re-sync with the renewed token, not the one in the auth context', async () => {
    render(<ResyncModal open={true} onOpenChange={() => undefined} />);
    await userEvent.click(await screen.findByTestId('resync-modal-start'));

    await waitFor(() => expect(runResyncAll).toHaveBeenCalledTimes(1));
    expect(vi.mocked(runResyncAll).mock.calls[0]![0].accessToken).toBe('FRESH');
  });
});
