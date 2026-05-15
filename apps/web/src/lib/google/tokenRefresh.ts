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
 *        c) On total failure, clear tokens (forces the user back to /login)
 *           and call `onAuthLost` so `AuthProvider` can flip status to
 *           `'anonymous'`.
 *   3. After every successful refresh, reschedule for the new expiry.
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

  const computeDelay = options.computeDelay ?? ((expiresAt: number) => nextRefreshDelay(expiresAt));

  const schedule = async (): Promise<void> => {
    if (stopped) return;
    const current = await getTokens();
    if (!current) return;
    const delay = computeDelay(current.accessTokenExpiresAt);
    timer = setTimeout(() => {
      void (async () => {
        if (stopped) return;
        const ok = await performRefresh();
        if (!ok) {
          await clearTokens();
          options.onAuthLost?.();
          return;
        }
        await schedule();
      })();
    }, delay);
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
