import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '@/features/auth/authContext';
import { runBootstrap, type BootstrapResult } from '@/features/sync/bootstrap';
import {
  _resetSnapshotAppliedForTesting,
  emitSnapshotApplied,
} from '@/features/sync/snapshotEvents';
import { toast } from 'sonner';

import { SyncOrchestrator } from './SyncOrchestrator';

vi.mock('@/features/sync/bootstrap', () => ({ runBootstrap: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

type Tokens = AuthContextValue['tokens'];

const tok = (accessToken: string): Tokens =>
  ({ accessToken, scope: 'openid drive calendar' }) as Tokens;

function setup(tokens: Tokens) {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const ui = (t: Tokens) => (
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={{ tokens: t } as AuthContextValue}>
        <SyncOrchestrator />
      </AuthContext.Provider>
    </QueryClientProvider>
  );
  const r = render(ui(tokens));
  return { invalidate, rerender: (t: Tokens) => r.rerender(ui(t)), unmount: r.unmount };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  _resetSnapshotAppliedForTesting();
  vi.mocked(runBootstrap).mockResolvedValue({ outcome: 'in-sync', hasCalendarScope: true });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  warn.mockRestore();
  _resetSnapshotAppliedForTesting();
});

describe('SyncOrchestrator — bootstrap once per session', () => {
  it('does not bootstrap while signed out', () => {
    setup(null);
    expect(runBootstrap).not.toHaveBeenCalled();
  });

  it('bootstraps once with the session token', () => {
    setup(tok('a'));
    expect(runBootstrap).toHaveBeenCalledTimes(1);
    expect(runBootstrap).toHaveBeenCalledWith({
      accessToken: 'a',
      grantedScopes: 'openid drive calendar',
    });
  });

  it('does not re-run on a silent token refresh', () => {
    const { rerender } = setup(tok('a'));
    rerender(tok('b'));
    expect(runBootstrap).toHaveBeenCalledTimes(1);
  });

  it('runs again after sign-out and a new sign-in', () => {
    const { rerender } = setup(tok('a'));
    rerender(null);
    rerender(tok('c'));
    expect(runBootstrap).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runBootstrap).mock.calls[1]![0].accessToken).toBe('c');
  });
});

describe('SyncOrchestrator — reconsent toasts', () => {
  it.each<[BootstrapResult, string[]]>([
    [{ outcome: 'no-scope' }, ['sync.reconsentRequired']],
    [
      { outcome: 'merged-remote-newer', hasCalendarScope: false },
      ['googleCalendar.reconsentRequired'],
    ],
    [{ outcome: 'failed', hasCalendarScope: false }, []],
    [{ outcome: 'no-token', hasCalendarScope: false }, []],
    [{ outcome: 'in-sync', hasCalendarScope: true }, []],
  ])('%o → %o', async (result, toasts) => {
    vi.mocked(runBootstrap).mockResolvedValue(result);
    setup(tok('a'));
    await waitFor(() => expect(runBootstrap).toHaveBeenCalled());
    await act(async () => {});
    expect(vi.mocked(toast.error).mock.calls.map(([key]) => key)).toEqual(toasts);
  });

  it('contains a rejected bootstrap — logged, no toast', async () => {
    vi.mocked(runBootstrap).mockRejectedValue(new Error('x'));
    setup(tok('a'));
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[sync] bootstrap threw:', expect.any(Error)),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('SyncOrchestrator — pulled data reaches the UI', () => {
  it('invalidates every synced store on snapshot-applied, until unmounted', () => {
    const { invalidate, unmount } = setup(null);
    act(() => emitSnapshotApplied());
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['entries'],
      ['cards'],
      ['settings'],
      ['payments'],
      ['reminders'],
    ]);

    unmount();
    emitSnapshotApplied();
    expect(invalidate).toHaveBeenCalledTimes(5);
  });
});
