import { GisFlowError, refreshAccessToken, silentReauth } from './gisClient';
import { clearTokens, getTokens, setTokens } from './tokenStore';

/**
 * Background token-refresh loop.
 *
 * Behavior:
 *   1. On `start()`, schedule a refresh ~5 minutes BEFORE `accessTokenExpiresAt`.
 *   2. When the timer fires:
 *        a) If a refresh token is present, exchange it at Google's token
 *           endpoint via `refreshAccessToken(rt)`.
 *        b) On failure (or when no refresh token exists), attempt silent
 *           re-auth via `silentReauth(email)` — which uses GIS
 *           `initTokenClient` with `prompt: 'none'`. The interactive
 *           sign-in path uses a full-page redirect that would yank the user
 *           out of the app, which is unacceptable for background token
 *           renewal — `initTokenClient` is the only renewal-friendly flow.
 *        c) On failure, retry with a short backoff (`RETRY_DELAYS_MS`).
 *           Only after the backoff is exhausted do we clear tokens (forcing
 *           the user back to /login) and call `onAuthLost` so `AuthProvider`
 *           can flip status to `'anonymous'`.
 *   3. After every successful refresh, reschedule for the new expiry.
 *
 * OFFLINE HOLD — HourTrack is an offline-first PWA: every surface reads from
 * Dexie and needs no network. Signing the user out because a renewal could
 * not reach Google would lock them out of their own local data behind a
 * /login screen they cannot complete without a network. So while
 * `navigator.onLine === false` we do not attempt a refresh at all, do not
 * spend the retry budget, and keep the (possibly stale) tokens — we just
 * re-check every `OFFLINE_RECHECK_MS` until connectivity returns.
 *
 * `start()` returns the disposer that cancels the next pending timer and
 * stops the loop. Safe to call `start()` multiple times -- the disposer
 * pattern means the caller (`AuthProvider`) is responsible for stopping the
 * previous instance before starting a new one.
 *
 * The worker runs in the main thread for S09; if perf-profiling later shows
 * pressure, move to a Web Worker in P4 (note in PROJECT_PLAN section 9.1).
 */

const REFRESH_LEAD_MS = 5 * 60 * 1000; // 5 minutes
const MIN_DELAY_MS = 1000; // never sleep less than 1s — prevents tight loops

/**
 * Backoff between failed renewal attempts, in order. A transient failure
 * (flaky Wi-Fi, a Google 5xx, a captive portal) must not sign the user out on
 * the first miss. Auth is dropped only after every entry is exhausted.
 */
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 5 * 60_000] as const;

/** How often to re-check connectivity while the device is offline. */
const OFFLINE_RECHECK_MS = 30_000;

/** `true` only when the browser positively reports no connectivity. */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export interface TokenRefreshOptions {
  /** Invoked after auth is fully lost (refresh + silent re-auth both failed). */
  onAuthLost?: () => void;
  /**
   * For tests: override the "ms until next refresh" computation. When unset
   * the default behavior subtracts `REFRESH_LEAD_MS` from the expiry epoch.
   */
  computeDelay?: (expiresAt: number) => number;
}

/**
 * Compute the next refresh delay in ms based on the access-token expiry. We
 * subtract a 5-minute lead so the refresh happens BEFORE the token expires.
 * Clamps to `MIN_DELAY_MS` for already-expired tokens (the refresh worker
 * shouldn't tight-loop, but neither should it wait indefinitely).
 */
export function nextRefreshDelay(expiresAt: number, nowMs = Date.now()): number {
  const target = expiresAt - REFRESH_LEAD_MS;
  return Math.max(MIN_DELAY_MS, target - nowMs);
}

/**
 * Perform a single refresh attempt and persist the new tokens.
 *
 * Strategy:
 *   1. Prefer the refresh-token grant when a token is present.
 *   2. Fall back to silent re-auth (`prompt: 'none'`) when no refresh token
 *      exists OR the refresh-token grant fails.
 *   3. Returns the new tokens or null when both paths fail.
 *
 * Exported for unit testing — `start()` calls this on each timer tick.
 */
export async function performRefresh(): Promise<boolean> {
  const current = await getTokens();
  if (!current) return false;

  // Path A: refresh-token grant.
  if (current.refreshToken) {
    try {
      const res = await refreshAccessToken(current.refreshToken);
      await setTokens({
        accessToken: res.access_token,
        accessTokenExpiresAt: Date.now() + res.expires_in * 1000,
        // Some Google responses omit refresh_token on subsequent refreshes;
        // keep the existing one when so.
        refreshToken: res.refresh_token ?? current.refreshToken,
        idToken: res.id_token ?? current.idToken,
        scope: res.scope || current.scope,
      });
      return true;
    } catch (err) {
      // Fall through to silent re-auth.
      if (err instanceof GisFlowError) {
        console.warn('[tokenRefresh] refresh_token grant failed, attempting silent re-auth', err);
      } else {
        console.warn('[tokenRefresh] refresh failed, attempting silent re-auth', err);
      }
    }
  }

  // Path B: silent re-auth via GIS `initTokenClient` with `prompt: 'none'`.
  // This flow does NOT return refresh_token or id_token — we carry the
  // previous values forward so nothing downstream that depends on them
  // (e.g. cached identity, future refresh-grant attempts) regresses.
  try {
    const res = await silentReauth(current.email ?? undefined);
    await setTokens({
      accessToken: res.access_token,
      accessTokenExpiresAt: Date.now() + res.expires_in * 1000,
      refreshToken: current.refreshToken,
      idToken: current.idToken,
      scope: res.scope || current.scope,
    });
    return true;
  } catch (err) {
    console.warn('[tokenRefresh] silent re-auth failed', err);
    return false;
  }
}

/**
 * Start the refresh loop. Returns a disposer that stops the loop and cancels
 * the next pending timer.
 */
export function startTokenRefresh(options: TokenRefreshOptions = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  /** Consecutive failed attempts made while the device reported connectivity. */
  let failures = 0;

  const computeDelay = options.computeDelay ?? ((expiresAt: number) => nextRefreshDelay(expiresAt));

  const armIn = (delay: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick();
    }, delay);
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    // Offline hold — see the module docblock. No attempt, no retry spent.
    if (isOffline()) {
      armIn(OFFLINE_RECHECK_MS);
      return;
    }
    // Signed out from elsewhere (another tab, the profile menu) — nothing to
    // renew, and no `onAuthLost` to fire: the token store already told the app.
    const current = await getTokens();
    if (stopped) return;
    if (!current) return;

    const ok = await performRefresh();
    if (stopped) return;

    if (ok) {
      failures = 0;
      await schedule();
      return;
    }

    // A drop in connectivity mid-attempt is an offline hold, not a failure.
    if (isOffline()) {
      armIn(OFFLINE_RECHECK_MS);
      return;
    }

    failures += 1;
    const backoff = RETRY_DELAYS_MS[failures - 1];
    if (backoff !== undefined) {
      armIn(backoff);
      return;
    }

    await clearTokens();
    options.onAuthLost?.();
  };

  const schedule = async (): Promise<void> => {
    if (stopped) return;
    const current = await getTokens();
    if (stopped) return;
    if (!current) return;
    armIn(computeDelay(current.accessTokenExpiresAt));
  };

  void schedule();

  return () => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
