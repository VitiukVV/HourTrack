import { runBootstrap, type BootstrapResult } from './bootstrap';
import { nextRetryDelay } from './retryPolicy';

/**
 * Session pulls (spec 016 §4, FR-002/003): keep a signed-in device up to date
 * with what other devices write, without a restart or a manual action.
 *
 *   - Pull once when the session starts.
 *   - Pull again when the app becomes visible or the connection returns —
 *     unless the last SUCCESSFUL pull was less than `PULL_MIN_INTERVAL_MS` ago.
 *   - A `failed` pull retries with the sync backoff (2 s … 60 s). A retry that
 *     comes due while the app is hidden or offline is skipped; the visibility
 *     / online trigger takes over (no sign-in window pops up in a background
 *     tab).
 *   - `no-token` / `no-scope` / `update-required` never retry on their own.
 *
 * Plain TS on purpose — unit-testable without rendering, and every clock,
 * timer and event source is injectable (fake timers deadlock with
 * fake-indexeddb in this repo).
 */

export const PULL_MIN_INTERVAL_MS = 120_000;

type Timer = ReturnType<typeof setTimeout>;

interface EventSource {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface SessionPullOptions {
  /** Called with every pull's result (toasts, logging). */
  onResult?: (result: BootstrapResult) => void;
  /** The pull itself. Defaults to `runBootstrap` (→ `SyncManager.pullNow`). */
  pull?: () => Promise<BootstrapResult>;
  minIntervalMs?: number;
  /** Delay before retry number `failures` (0-based). Defaults to `nextRetryDelay`. */
  retryDelay?: (failures: number) => number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  /** Source of `online` events. Defaults to `window`. */
  windowTarget?: EventSource;
  /** Source of `visibilitychange` events + `visibilityState`. Defaults to `document`. */
  documentTarget?: EventSource & { visibilityState: DocumentVisibilityState };
  isOnline?: () => boolean;
}

const SUCCESS: ReadonlySet<BootstrapResult['outcome']> = new Set([
  'created',
  'pulled',
  'unchanged',
]);

/** Start pulling for this session. Returns a disposer that stops everything. */
export function startSessionPull(opts: SessionPullOptions = {}): () => void {
  const pull = opts.pull ?? (() => runBootstrap());
  const minIntervalMs = opts.minIntervalMs ?? PULL_MIN_INTERVAL_MS;
  const retryDelay = opts.retryDelay ?? nextRetryDelay;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t));
  const win = opts.windowTarget ?? (typeof window !== 'undefined' ? window : undefined);
  const doc = opts.documentTarget ?? (typeof document !== 'undefined' ? document : undefined);
  const isOnline =
    opts.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  let disposed = false;
  let running = false;
  let lastSuccessAt: number | null = null;
  let failures = 0;
  let retryTimer: Timer | null = null;

  const canPullNow = () => isOnline() && doc?.visibilityState !== 'hidden';

  const cancelRetry = () => {
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
  };

  const run = async (): Promise<void> => {
    if (disposed || running || !canPullNow()) return;
    running = true;
    cancelRetry();
    let result: BootstrapResult;
    try {
      result = await pull();
    } catch (err) {
      // `pullNow` never throws; stay defensive so a bug can't stop the retries.
      result = {
        outcome: 'failed',
        conflictCount: 0,
        hasCalendarScope: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      running = false;
    }
    if (disposed) return;
    if (SUCCESS.has(result.outcome)) {
      lastSuccessAt = now();
      failures = 0;
    } else if (result.outcome === 'failed') {
      retryTimer = setTimer(() => {
        retryTimer = null;
        void run();
      }, retryDelay(failures));
      failures += 1;
    }
    try {
      opts.onResult?.(result);
    } catch (err) {
      console.error('[sync] session pull result handler threw:', err);
    }
  };

  const onReturn = () => {
    if (lastSuccessAt !== null && now() - lastSuccessAt < minIntervalMs) return;
    void run();
  };
  const onVisibility = () => {
    if (doc?.visibilityState === 'visible') onReturn();
  };

  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('online', onReturn);
  void run();

  return () => {
    disposed = true;
    cancelRetry();
    doc?.removeEventListener('visibilitychange', onVisibility);
    win?.removeEventListener('online', onReturn);
  };
}
