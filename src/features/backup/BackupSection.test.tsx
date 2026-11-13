import 'fake-indexeddb/auto';
import type * as tokenRefreshModule from '@/lib/google/tokenRefresh';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import i18n from '@/lib/i18n/i18n';

import { db, initDB, updateSettings } from '@/lib/db';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { setTokens } from '@/lib/google/tokenStore';
import { SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { BackupSection } from './BackupSection';

type TokenRefreshModule = typeof tokenRefreshModule;

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

/**
 * What `getFreshAccessToken` / `forceRenewAccessToken` answer when a test
 * sets them (`undefined` = the real helper). Lets a test hold a STALE token
 * in the auth context while the renewal hands out another one.
 */
const tokenOverride = vi.hoisted(() => ({
  fresh: undefined as string | null | undefined,
  renewed: undefined as string | null | undefined,
}));

vi.mock('@/lib/google/tokenRefresh', async (importOriginal) => {
  const actual = await importOriginal<TokenRefreshModule>();
  return {
    // Spec 014: SyncManager reads the token through the real on-demand helpers.
    ...actual,
    getFreshAccessToken: (...args: Parameters<TokenRefreshModule['getFreshAccessToken']>) =>
      tokenOverride.fresh !== undefined
        ? Promise.resolve(tokenOverride.fresh)
        : actual.getFreshAccessToken(...args),
    forceRenewAccessToken: (...args: Parameters<TokenRefreshModule['forceRenewAccessToken']>) =>
      tokenOverride.renewed !== undefined
        ? Promise.resolve(tokenOverride.renewed)
        : actual.forceRenewAccessToken(...args),
    startTokenRefresh: () => () => undefined,
    performRefresh: vi.fn(),
    nextRefreshDelay: vi.fn(),
  };
});

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
  // An authed render mounts useBackupsList -> Drive `files.list`; answer it
  // with an empty list instead of hitting the real API.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ files: [] }), { status: 200 })),
  );
  await db.authTokens.clear();
  await db.settings.clear();
  await initDB(db);
});

afterEach(() => {
  tokenOverride.fresh = undefined;
  tokenOverride.renewed = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function signInAs(accessToken: string): Promise<void> {
  await setTokens({
    accessToken,
    accessTokenExpiresAt: Date.now() + 3_600_000,
    scope: `openid email profile ${SCOPE_DRIVE_APPDATA}`,
  });
}

/** Every request's method, URL and bearer, recorded by a stubbed fetch. */
function recordFetch(answer: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ method: string; url: string; auth: string | undefined }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ method: init?.method ?? 'GET', url, auth: headers.Authorization });
      return answer(url, init);
    }),
  );
  return calls;
}

const listReply = () => new Response(JSON.stringify({ files: [] }), { status: 200 });
const createReply = () =>
  new Response(JSON.stringify({ id: 'b1', name: 'backups/x.json', version: '1' }), {
    status: 200,
  });

async function clickCreateBackup(): Promise<void> {
  const btn = await screen.findByTestId('settings-data-create-backup');
  await waitFor(() => expect(btn).not.toBeDisabled(), { timeout: 10_000 });
  await userEvent.click(btn);
}

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

describe('BackupSection — fresh sign-in for Drive calls (spec 016 review B2/B3)', () => {
  it('lists and creates with the renewed token, not the stale one in the auth context', async () => {
    await signInAs('STALE');
    tokenOverride.fresh = 'FRESH';
    const calls = recordFetch((_url, init) =>
      init?.method === 'POST' ? createReply() : listReply(),
    );
    render(
      <Wrap>
        <BackupSection />
      </Wrap>,
    );
    await clickCreateBackup();

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.some((c) => c.method === 'GET' && c.url.includes('pageSize=1000'))).toBe(true);
    expect(calls.map((c) => c.auth)).toEqual(calls.map(() => 'Bearer FRESH'));
  });

  it('a 401 that renewal cannot fix asks the user to sign in, not "Drive API error 401"', async () => {
    const error = vi.spyOn(toast, 'error');
    await signInAs('AT');
    tokenOverride.fresh = 'AT';
    tokenOverride.renewed = null;
    recordFetch((_url, init) =>
      init?.method === 'POST' ? new Response('{"error":"expired"}', { status: 401 }) : listReply(),
    );
    render(
      <Wrap>
        <BackupSection />
      </Wrap>,
    );
    await clickCreateBackup();

    const banner = await screen.findByTestId('backup-error-banner');
    expect(banner.textContent).toContain(i18n.t('backup.signInRequired'));
    expect(banner.textContent).not.toContain('401');
    expect(error).toHaveBeenCalledWith(i18n.t('backup.signInRequired'));
  });

  it('a lost sign-in (no token to renew) asks the user to sign in', async () => {
    await signInAs('AT');
    recordFetch(listReply);
    render(
      <Wrap>
        <BackupSection />
      </Wrap>,
    );
    const btn = await screen.findByTestId('settings-data-create-backup');
    await waitFor(() => expect(btn).not.toBeDisabled(), { timeout: 10_000 });
    tokenOverride.fresh = null;
    await userEvent.click(btn);

    const banner = await screen.findByTestId('backup-error-banner');
    expect(banner.textContent).toContain(i18n.t('backup.signInRequired'));
    expect(banner.textContent).not.toContain('Not signed in');
  });
});
