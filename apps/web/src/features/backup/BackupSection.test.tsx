import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import '@/lib/i18n';

import { db, initDB, updateSettings } from '@/lib/db';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { setTokens } from '@/lib/google/tokenStore';
import { SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { BackupSection } from './BackupSection';

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

beforeEach(async () => {
  await db.authTokens.clear();
  await db.settings.clear();
  await initDB(db);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('BackupSection', () => {
  it('renders the backup status caption with "No backups yet" when lastBackupAt is null', async () => {
    render(
      <Wrap>
        <BackupSection />
      </Wrap>,
    );
    await screen.findByTestId('settings-data');
    expect(screen.getByTestId('settings-data-backup-status').textContent).toMatch(
      /No backups|Резервних|Aún no hay/,
    );
  });

  it('renders the formatted last-backup date when lastBackupAt is set', async () => {
    await updateSettings(db, { lastBackupAt: '2026-05-15T17:42:00.000Z' });
    render(
      <Wrap>
        <BackupSection />
      </Wrap>,
    );
    await screen.findByTestId('settings-data');
    // formatDate emits DD.MM.YYYY. The displayed time is the local-zone
    // version of 17:42 UTC, so we only assert on the date portion and that
    // the i18n shape is correct.
    await waitFor(() =>
      expect(screen.getByTestId('settings-data-backup-status').textContent).toMatch(/15\.05\.2026/),
    );
  });

  it('disables Create backup when the user is anonymous', async () => {
    render(
      <Wrap>
        <BackupSection />
      </Wrap>,
    );
    const btn = await screen.findByTestId('settings-data-create-backup');
    await waitFor(() => expect(btn).toBeDisabled());
  });

  it('enables Create backup when the user is authed with drive.appdata scope', async () => {
    await setTokens({
      accessToken: 'AT',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: `openid email profile ${SCOPE_DRIVE_APPDATA}`,
    });
    render(
      <Wrap>
        <BackupSection />
      </Wrap>,
    );
    const btn = await screen.findByTestId('settings-data-create-backup');
    await waitFor(() => expect(btn).not.toBeDisabled(), { timeout: 10_000 });
  });

  it('toggle auto-backup writes back to settings', async () => {
    render(
      <Wrap>
        <BackupSection />
      </Wrap>,
    );
    await screen.findByTestId('settings-data-auto-backup');
    const toggle = screen.getByLabelText(/Automatic backup|Автоматична|Copia automática/);
    expect(toggle).toBeInTheDocument();
    await userEvent.click(toggle);
    await waitFor(
      async () => {
        const { getSettings } = await import('@/lib/db');
        const settings = await getSettings(db);
        // Default is true; after one click it should be false.
        expect(settings?.autoBackupEnabled).toBe(false);
      },
      { timeout: 10_000 },
    );
  });
});
