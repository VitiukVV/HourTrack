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
  appProperties: { schemaVersion: '2' },
  isPreRestore: false,
};

// S16: a fixture that simulates a pre-v2 backup still sitting in the user's
// Drive App Folder. The Restore modal must short-circuit to the dedicated
// "version mismatch" screen as soon as the user selects it.
const v1File: BackupFile = {
  ...file,
  id: 'file-v1',
  appProperties: { schemaVersion: '1' },
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

  it('shows the version-mismatch screen and hides the Restore button when the selected backup is pre-v2', async () => {
    const onComplete = vi.fn();
    render(
      <Wrap>
        <RestoreModal
          open={true}
          file={v1File}
          onOpenChange={() => undefined}
          onRestoreComplete={onComplete}
        />
      </Wrap>,
    );
    // Dedicated screen renders — title + body + Dismiss are all present.
    expect(await screen.findByTestId('restore-modal-version-mismatch-title')).toBeInTheDocument();
    expect(screen.getByTestId('restore-modal-version-mismatch-body')).toBeInTheDocument();
    expect(screen.getByTestId('restore-modal-version-mismatch-dismiss')).toBeInTheDocument();
    // The destructive Restore button MUST NOT be reachable. The two-step
    // confirm flow's Continue button is the gate to the Restore button;
    // the version-mismatch branch should NOT render it.
    expect(screen.queryByTestId('restore-modal-continue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('restore-modal-confirm')).not.toBeInTheDocument();
    // We never download / parse / runRestore for a known-bad file.
    expect(runRestoreMock).not.toHaveBeenCalled();
  });

  it('S29: a current (v5) backup passes the pre-download gate — no version-mismatch screen', async () => {
    const v5File: BackupFile = { ...file, id: 'file-v5', appProperties: { schemaVersion: '5' } };
    render(
      <Wrap>
        <RestoreModal open={true} file={v5File} onOpenChange={() => undefined} />
      </Wrap>,
    );
    // The regression this fixes: '5' used to trip the hardcoded `=== '2'` gate
    // and block the backup before download. It must now reach step 1 confirm.
    expect(screen.queryByTestId('restore-modal-version-mismatch-title')).not.toBeInTheDocument();
    expect(await screen.findByTestId('restore-modal-continue')).toBeInTheDocument();
  });

  it('switches to the version-mismatch screen when runRestore returns `versionMismatch` for an unflagged file', async () => {
    // Cover the defense-in-depth path: a file whose appProperties were
    // missing/misstamped slips through the modal-side gate, but
    // runRestore catches the v1 schema during validation and returns
    // `validationCode: 'versionMismatch'`. The modal MUST flip to the
    // dedicated screen rather than firing a generic error toast.
    runRestoreMock.mockResolvedValueOnce({
      outcome: 'invalid',
      validationCode: 'versionMismatch',
      error: 'Unsupported snapshot schemaVersion.',
    });
    const unstampedFile: BackupFile = {
      ...file,
      id: 'file-unstamped',
      appProperties: undefined, // no schemaVersion property — slips past the modal-side gate
    };
    render(
      <Wrap>
        <RestoreModal open={true} file={unstampedFile} onOpenChange={() => undefined} />
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
    // Now on the version-mismatch screen.
    expect(await screen.findByTestId('restore-modal-version-mismatch-title')).toBeInTheDocument();
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
