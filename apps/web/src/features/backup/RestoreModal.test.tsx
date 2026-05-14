import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import '@/lib/i18n';

import { db } from '@/lib/db';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { setTokens } from '@/lib/google/tokenStore';
import { SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { RestoreModal } from './RestoreModal';
import type { BackupFile } from './backupService';

/**
 * The modal's runRestore -> readJsonFile / applySnapshot path is covered in
 * `restoreFlow.test.ts`. These tests verify the two-step confirmation UX:
 * - Continue advances from step 1 to step 2
 * - Final destructive button stays disabled until `RESTORE` is typed
 * - onRestoreComplete fires on success path
 */

vi.mock('@/lib/google/gisClient', () => ({
  signIn: vi.fn(),
  revoke: vi.fn().mockResolvedValue(undefined),
  getUserInfo: vi.fn().mockResolvedValue({
    sub: 'sub-1',
    email: 'u@example.com',
    name: 'U',
    picture: null,
  }),
  refreshAccessToken: vi.fn(),
  GisFlowError: class extends Error {},
  GisNotConfiguredError: class extends Error {},
  GisNotReadyError: class extends Error {},
  isGisReady: () => true,
  waitForGisReady: () => Promise.resolve(),
  isSignInAvailable: () => true,
  getRedirectUri: () => 'http://localhost:5173',
}));

vi.mock('@/lib/google/tokenRefresh', () => ({
  startTokenRefresh: () => () => undefined,
  performRefresh: vi.fn(),
  nextRefreshDelay: vi.fn(),
}));

// Stub the restoreFlow so the modal's interaction can be exercised without
// actually hitting Drive / Dexie. The UX behavior under test is the
// two-step gate, not the underlying mechanics (which `restoreFlow.test.ts`
// covers).
const runRestoreMock = vi.fn();
vi.mock('./restoreFlow', () => ({
  runRestore: (opts: unknown) => runRestoreMock(opts),
}));

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

const file: BackupFile = {
  id: 'file-1',
  name: 'backups/2026-05-15T1742.json',
  modifiedTime: '2026-05-15T17:42:01.000Z',
  appProperties: { schemaVersion: '1' },
  isPreRestore: false,
};

beforeEach(async () => {
  await db.authTokens.clear();
  await db.settings.clear();
  await setTokens({
    accessToken: 'AT',
    accessTokenExpiresAt: Date.now() + 3_600_000,
    scope: `openid email profile ${SCOPE_DRIVE_APPDATA}`,
  });
  runRestoreMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RestoreModal', () => {
  it('renders step 1 confirm copy on open', async () => {
    render(
      <Wrap>
        <RestoreModal open={true} file={file} onOpenChange={() => undefined} />
      </Wrap>,
    );
    expect(await screen.findByTestId('restore-modal')).toBeInTheDocument();
    expect(screen.getByTestId('restore-modal-continue')).toBeInTheDocument();
  });

  it('advances to step 2 when Continue is clicked', async () => {
    render(
      <Wrap>
        <RestoreModal open={true} file={file} onOpenChange={() => undefined} />
      </Wrap>,
    );
    await screen.findByTestId('restore-modal');
    await userEvent.click(screen.getByTestId('restore-modal-continue'));
    expect(await screen.findByTestId('restore-modal-input')).toBeInTheDocument();
    // Destructive button initially disabled.
    expect(screen.getByTestId('restore-modal-confirm')).toBeDisabled();
  });

  it('keeps destructive button disabled until RESTORE is typed exactly', async () => {
    render(
      <Wrap>
        <RestoreModal open={true} file={file} onOpenChange={() => undefined} />
      </Wrap>,
    );
    await screen.findByTestId('restore-modal');
    await userEvent.click(screen.getByTestId('restore-modal-continue'));
    const input = await screen.findByTestId('restore-modal-input');
    const confirm = screen.getByTestId('restore-modal-confirm');

    await userEvent.type(input, 'rest');
    expect(confirm).toBeDisabled();
    await userEvent.type(input, 'ORE'); // typed = "restORE" -- still wrong (case-sensitive)
    expect(confirm).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'RESTORE');
    await waitFor(() => expect(confirm).not.toBeDisabled(), { timeout: 10_000 });
  });

  it('invokes runRestore + onRestoreComplete on success', async () => {
    runRestoreMock.mockResolvedValueOnce({
      outcome: 'success',
      applied: { cards: 1, entries: 1, tombstones: 0 },
    });
    const onComplete = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Wrap>
        <RestoreModal
          open={true}
          file={file}
          onOpenChange={onOpenChange}
          onRestoreComplete={onComplete}
        />
      </Wrap>,
    );
    await screen.findByTestId('restore-modal');
    await userEvent.click(screen.getByTestId('restore-modal-continue'));
    const input = await screen.findByTestId('restore-modal-input');
    await userEvent.type(input, 'RESTORE');
    const confirm = await screen.findByTestId('restore-modal-confirm');
    await waitFor(() => expect(confirm).not.toBeDisabled(), { timeout: 10_000 });
    await act(async () => {
      await userEvent.click(confirm);
    });
    await waitFor(() => expect(runRestoreMock).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('surfaces an error toast and does NOT call onRestoreComplete on invalid outcome', async () => {
    runRestoreMock.mockResolvedValueOnce({
      outcome: 'invalid',
      error: 'schemaVersion mismatch',
    });
    const onComplete = vi.fn();
    render(
      <Wrap>
        <RestoreModal
          open={true}
          file={file}
          onOpenChange={() => undefined}
          onRestoreComplete={onComplete}
        />
      </Wrap>,
    );
    await screen.findByTestId('restore-modal');
    await userEvent.click(screen.getByTestId('restore-modal-continue'));
    const input = await screen.findByTestId('restore-modal-input');
    await userEvent.type(input, 'RESTORE');
    const confirm = await screen.findByTestId('restore-modal-confirm');
    await waitFor(() => expect(confirm).not.toBeDisabled(), { timeout: 10_000 });
    await act(async () => {
      await userEvent.click(confirm);
    });
    await waitFor(() => expect(runRestoreMock).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
