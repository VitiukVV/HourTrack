import { describe, expect, it, vi } from 'vitest';

import { withFreshToken, NotSignedInError } from './authorizedCall';
import { CalendarAuthError } from './calendar';
import { DriveAuthError } from './drive';

function tokens(fresh: string | null, renewed: string | null = null) {
  return {
    getFresh: vi.fn(async () => fresh),
    forceRenew: vi.fn(async () => renewed),
  };
}

describe('withFreshToken', () => {
  it('calls once with the fresh token and returns the result', async () => {
    const t = tokens('A');
    const call = vi.fn(async (token: string) => `ok:${token}`);
    await expect(withFreshToken(call, t)).resolves.toBe('ok:A');
    expect(call).toHaveBeenCalledTimes(1);
    expect(t.forceRenew).not.toHaveBeenCalled();
  });

  it('throws NotSignedInError without calling when there is no token', async () => {
    const call = vi.fn();
    await expect(withFreshToken(call, tokens(null))).rejects.toBeInstanceOf(NotSignedInError);
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    ['DriveAuthError', () => new DriveAuthError('401')],
    ['CalendarAuthError', () => new CalendarAuthError('401')],
  ])('renews and retries once on %s', async (_name, make) => {
    const t = tokens('A', 'B');
    const call = vi.fn(async (token: string) => {
      if (token === 'A') throw make();
      return `ok:${token}`;
    });
    await expect(withFreshToken(call, t)).resolves.toBe('ok:B');
    expect(call).toHaveBeenCalledTimes(2);
    expect(t.forceRenew).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original error when renewal returns null', async () => {
    const err = new DriveAuthError('401');
    const call = vi.fn().mockRejectedValue(err);
    await expect(withFreshToken(call, tokens('A', null))).rejects.toBe(err);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original error when renewal returns the same token', async () => {
    const err = new DriveAuthError('401');
    const call = vi.fn().mockRejectedValue(err);
    await expect(withFreshToken(call, tokens('A', 'A'))).rejects.toBe(err);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('retries only once: a second 401 propagates', async () => {
    const second = new DriveAuthError('again');
    const call = vi
      .fn()
      .mockRejectedValueOnce(new DriveAuthError('first'))
      .mockRejectedValueOnce(second);
    await expect(withFreshToken(call, tokens('A', 'B'))).rejects.toBe(second);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('does not renew for other errors', async () => {
    const t = tokens('A', 'B');
    const err = new Error('boom');
    await expect(withFreshToken(vi.fn().mockRejectedValue(err), t)).rejects.toBe(err);
    expect(t.forceRenew).not.toHaveBeenCalled();
  });
});
