import { render } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '@/features/auth/authContext';
import type { BootstrapResult } from '@/features/sync/bootstrap';
import { startSessionPull, type SessionPullOptions } from '@/features/sync/sessionPull';

import { SyncOrchestrator } from './SyncOrchestrator';

vi.mock('@/features/sync/sessionPull', () => ({ startSessionPull: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

type Tokens = AuthContextValue['tokens'];

const tok = (accessToken: string): Tokens =>
  ({ accessToken, scope: 'openid drive calendar' }) as Tokens;

function setup(tokens: Tokens) {
  const ui = (t: Tokens) => (
    <AuthContext.Provider value={{ tokens: t } as AuthContextValue}>
      <SyncOrchestrator />
    </AuthContext.Provider>
  );
  const r = render(ui(tokens));
  return { rerender: (t: Tokens) => r.rerender(ui(t)), unmount: r.unmount };
}

const disposers: Array<ReturnType<typeof vi.fn>> = [];

/** The `onResult` the most recent session registered. */
function report(result: Partial<BootstrapResult> & Pick<BootstrapResult, 'outcome'>): void {
  const opts = vi.mocked(startSessionPull).mock.calls.at(-1)![0] as SessionPullOptions;
  opts.onResult!({ conflictCount: 0, hasCalendarScope: true, ...result });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(startSessionPull).mockImplementation(() => {
    const dispose = vi.fn();
    disposers.push(dispose);
    return dispose;
  });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  disposers.length = 0;
  warn.mockRestore();
});

describe('SyncOrchestrator — one pull session per sign-in', () => {
  it('does not start while signed out', () => {
    setup(null);
    expect(startSessionPull).not.toHaveBeenCalled();
  });

  it('starts once when signed in', () => {
    setup(tok('a'));
    expect(startSessionPull).toHaveBeenCalledTimes(1);
  });

  it('does not restart on a silent token refresh', () => {
    const { rerender } = setup(tok('a'));
    rerender(tok('b'));
    expect(startSessionPull).toHaveBeenCalledTimes(1);
    expect(disposers[0]).not.toHaveBeenCalled();
  });

  it('stops on sign-out and starts again on a new sign-in', () => {
    const { rerender } = setup(tok('a'));
    rerender(null);
    expect(disposers[0]).toHaveBeenCalledTimes(1);
    rerender(tok('c'));
    expect(startSessionPull).toHaveBeenCalledTimes(2);
  });

  it('stops on unmount', () => {
    const { unmount } = setup(tok('a'));
    unmount();
    expect(disposers[0]).toHaveBeenCalledTimes(1);
  });
});

describe('SyncOrchestrator — reconsent toasts', () => {
  it.each<[Partial<BootstrapResult> & Pick<BootstrapResult, 'outcome'>, string[]]>([
    [{ outcome: 'no-scope', hasCalendarScope: false }, ['sync.reconsentRequired']],
    [{ outcome: 'pulled', hasCalendarScope: false }, ['googleCalendar.reconsentRequired']],
    [{ outcome: 'unchanged', hasCalendarScope: false }, ['googleCalendar.reconsentRequired']],
    [{ outcome: 'failed', hasCalendarScope: false }, []],
    [{ outcome: 'no-token', hasCalendarScope: false }, []],
    [{ outcome: 'offline', hasCalendarScope: false }, []],
    [{ outcome: 'pulled', hasCalendarScope: true }, []],
  ])('%o → %o', (result, toasts) => {
    setup(tok('a'));
    report(result);
    expect(vi.mocked(toast.error).mock.calls.map(([key]) => key)).toEqual(toasts);
  });

  it('shows each toast once per session, again after a new sign-in', () => {
    const { rerender } = setup(tok('a'));
    report({ outcome: 'no-scope' });
    report({ outcome: 'no-scope' });
    report({ outcome: 'pulled', hasCalendarScope: false });
    report({ outcome: 'unchanged', hasCalendarScope: false });
    expect(vi.mocked(toast.error).mock.calls.map(([key]) => key)).toEqual([
      'sync.reconsentRequired',
      'googleCalendar.reconsentRequired',
    ]);

    rerender(null);
    rerender(tok('b'));
    report({ outcome: 'no-scope' });
    expect(toast.error).toHaveBeenCalledTimes(3);
  });

  it('logs a failed pull without a toast', () => {
    setup(tok('a'));
    report({ outcome: 'failed', error: 'network down' });
    expect(warn).toHaveBeenCalledWith('[sync] pull failed:', 'network down');
    expect(toast.error).not.toHaveBeenCalled();
  });
});
