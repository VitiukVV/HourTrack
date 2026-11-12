import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BootstrapResult } from './bootstrap';
import { PULL_MIN_INTERVAL_MS, startSessionPull, type SessionPullOptions } from './sessionPull';

type Outcome = BootstrapResult['outcome'];

const result = (outcome: Outcome): BootstrapResult => ({
  outcome,
  conflictCount: 0,
  hasCalendarScope: true,
});

/** Hand-driven clock, timers and event sources — no fake timers needed. */
function harness(outcomes: Outcome[] = []) {
  let clock = 1_000_000;
  let online = true;
  const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
  let nextId = 1;
  const listeners = new Map<string, Set<() => void>>();
  const source = () => ({
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
  });
  const doc = { ...source(), visibilityState: 'visible' as DocumentVisibilityState };
  const queue = [...outcomes];
  const pull = vi.fn(async () => result(queue.shift() ?? 'unchanged'));
  const onResult = vi.fn();

  const opts: SessionPullOptions = {
    pull,
    onResult,
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ fn, ms, id });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (t) => {
      const i = timers.findIndex((x) => x.id === (t as unknown as number));
      if (i !== -1) timers.splice(i, 1);
    },
    windowTarget: source(),
    documentTarget: doc,
    isOnline: () => online,
    retryDelay: (n) => 1000 * (n + 1),
  };

  return {
    opts,
    pull,
    onResult,
    timers,
    listeners,
    advance: (ms: number) => {
      clock += ms;
    },
    setOnline: (v: boolean) => {
      online = v;
    },
    setVisibility: (v: DocumentVisibilityState) => {
      doc.visibilityState = v;
    },
    fire: (type: string) => {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    /** Run the earliest pending timer. */
    runTimer: () => {
      const t = timers.shift();
      t?.fn();
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
});

describe('startSessionPull', () => {
  it('pulls once at session start and reports the result', async () => {
    const h = harness(['pulled']);
    dispose = startSessionPull(h.opts);
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
    expect(h.onResult).toHaveBeenCalledWith(result('pulled'));
  });

  it('re-pulls on return to the app only after the 2-minute throttle', async () => {
    const h = harness();
    dispose = startSessionPull(h.opts);
    await flush();

    h.advance(PULL_MIN_INTERVAL_MS - 1);
    h.fire('visibilitychange');
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);

    h.advance(1);
    h.fire('visibilitychange');
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(2);
  });

  it('ignores a visibilitychange to hidden', async () => {
    const h = harness();
    dispose = startSessionPull(h.opts);
    await flush();
    h.advance(PULL_MIN_INTERVAL_MS);
    h.setVisibility('hidden');
    h.fire('visibilitychange');
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
  });

  it('re-pulls when the connection returns (throttled like visibility)', async () => {
    const h = harness();
    dispose = startSessionPull(h.opts);
    await flush();
    h.fire('online');
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
    h.advance(PULL_MIN_INTERVAL_MS);
    h.fire('online');
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(2);
  });

  it('retries a failed pull with growing delays until it succeeds', async () => {
    const h = harness(['failed', 'failed', 'pulled']);
    dispose = startSessionPull(h.opts);
    await flush();
    expect(h.timers.map((t) => t.ms)).toEqual([1000]);

    h.runTimer();
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(2);
    expect(h.timers.map((t) => t.ms)).toEqual([2000]);

    h.runTimer();
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(3);
    expect(h.timers).toHaveLength(0);
  });

  it('a failed pull is not throttled: returning to the app pulls at once', async () => {
    const h = harness(['failed', 'pulled']);
    dispose = startSessionPull(h.opts);
    await flush();
    h.fire('visibilitychange');
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(2);
    // The success cancelled the pending retry.
    expect(h.timers).toHaveLength(0);
  });

  it('skips a retry that comes due while hidden or offline; the trigger takes over', async () => {
    const h = harness(['failed', 'pulled']);
    dispose = startSessionPull(h.opts);
    await flush();

    h.setVisibility('hidden');
    h.runTimer();
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);

    h.setVisibility('visible');
    h.fire('visibilitychange');
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(2);
  });

  it('does not pull at start while offline; pulls when back online', async () => {
    const h = harness();
    h.setOnline(false);
    dispose = startSessionPull(h.opts);
    await flush();
    expect(h.pull).not.toHaveBeenCalled();
    h.setOnline(true);
    h.fire('online');
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
  });

  it.each<Outcome>(['no-token', 'no-scope', 'update-required', 'offline'])(
    'does not arm a retry after %s',
    async (outcome) => {
      const h = harness([outcome]);
      dispose = startSessionPull(h.opts);
      await flush();
      expect(h.timers).toHaveLength(0);
    },
  );

  it('does not start a second pull while one is running', async () => {
    const h = harness();
    let release: () => void = () => {};
    h.pull.mockImplementationOnce(
      () =>
        new Promise<BootstrapResult>((resolve) => {
          release = () => resolve(result('failed'));
        }),
    );
    dispose = startSessionPull(h.opts);
    h.fire('online');
    h.fire('visibilitychange');
    expect(h.pull).toHaveBeenCalledTimes(1);
    release();
    await flush();
  });

  it('treats a thrown pull as failed and retries', async () => {
    const h = harness();
    h.pull.mockRejectedValueOnce(new Error('boom'));
    dispose = startSessionPull(h.opts);
    await flush();
    expect(h.onResult).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', error: 'boom' }),
    );
    expect(h.timers).toHaveLength(1);
  });

  it('contains a throwing result handler', async () => {
    const h = harness();
    h.onResult.mockImplementation(() => {
      throw new Error('handler');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    dispose = startSessionPull(h.opts);
    await flush();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('handler threw'), expect.any(Error));
    error.mockRestore();
  });

  it('dispose removes listeners, cancels the retry and drops a late result', async () => {
    const h = harness();
    let release: () => void = () => {};
    h.pull.mockImplementationOnce(
      () =>
        new Promise<BootstrapResult>((resolve) => {
          release = () => resolve(result('failed'));
        }),
    );
    const stop = startSessionPull(h.opts);
    stop();
    release();
    await flush();
    expect(h.onResult).not.toHaveBeenCalled();
    expect(h.timers).toHaveLength(0);
    expect(h.listeners.get('online')?.size ?? 0).toBe(0);
    expect(h.listeners.get('visibilitychange')?.size ?? 0).toBe(0);

    h.fire('online');
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
  });

  it('dispose cancels a pending retry timer', async () => {
    const h = harness(['failed']);
    const stop = startSessionPull(h.opts);
    await flush();
    expect(h.timers).toHaveLength(1);
    stop();
    expect(h.timers).toHaveLength(0);
  });
});
