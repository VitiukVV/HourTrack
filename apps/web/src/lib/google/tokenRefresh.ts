import { SCOPE_DRIVE_APPDATA } from './config';
import {
  GisFlowError,
  getUserInfo,
  normalizeExpiresIn,
  refreshAccessToken,
  silentReauth,
} from './gisClient';
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
 *        c) The attempt is CLASSIFIED, not counted — see {@link RefreshOutcome}.
 *           Only a refusal that actually means "this grant is gone" ends the
 *           session; anything that merely failed to complete keeps the tokens
 *           and retries, for as long as it takes.
 *   3. After every successful refresh, reschedule for the new expiry.
 *
 * OFFLINE HOLD — HourTrack is an offline-first PWA: every surface reads from
 * Dexie and needs no network. Signing the user out because a renewal could
 * not reach Google would lock them out of their own local data behind a
 * /login screen they cannot complete without a network. So while
 * `navigator.onLine === false` we do not attempt a refresh at all and keep the
 * (possibly stale) tokens — we just re-check every `OFFLINE_RECHECK_MS` until
 * connectivity returns.
 *
 * HIDDEN-TAB HOLD — GIS opens a real popup window even for `prompt: 'none'`.
 * Firing that from a background tab flashes a window over whatever the user is
 * actually doing (and browsers are far likelier to block it there, which then
 * reads as a renewal failure). A tick that lands while the tab is hidden is
 * therefore DEFERRED until it becomes visible again — not run, not dropped.
 *
 * `start()` returns the disposer that cancels the next pending timer and
 * stops the loop. Safe to call `start()` multiple times -- the disposer
 * pattern means the caller (`AuthProvider`) is responsible for stopping the
 * previous instance before starting a new one.
 *
 * The worker runs in the main thread for S09; if perf-profiling later shows
 * pressure, move to a Web Worker in P4 (note in PROJECT_PLAN section 9.1).
 *
 * The outcome classification, the hidden-tab hold and the two post-re-auth
 * identity checks are ported from my-diary's `src/lib/google/tokenRefresh.ts`.
 */

const REFRESH_LEAD_MS = 5 * 60 * 1000; // 5 minutes
const MIN_DELAY_MS = 1000; // never sleep less than 1s — prevents tight loops

/**
 * What a single renewal attempt actually meant:
 *
 *   - `refreshed` — a new access token is stored.
 *   - `transient` — the attempt could not COMPLETE: offline, a popup the
 *     browser blocked, a GIS script that never loaded, a Google 5xx. The grant
 *     is presumed intact, so keep the tokens and retry.
 *   - `auth-lost` — Google refused: interaction is required, consent was
 *     revoked, or the browser session moved to a different account. This is
 *     the ONLY outcome that ends the session.
 *
 * Counting attempts instead of classifying them made a long outage
 * indistinguishable from a revoked grant: three flaky renewals in a row and
 * the user was dumped at /login — out of an app whose every screen reads from
 * local Dexie and needs no network at all.
 */
export type RefreshOutcome = 'refreshed' | 'transient' | 'auth-lost';

/**
 * Backoff between transient failures, in order; the last entry repeats for as
 * long as the failures continue. Nothing in this list ever ends the session —
 * that is `auth-lost`'s job alone.
 */
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, MAX_RETRY_DELAY_MS] as const;

/** How often to re-check connectivity while the device is offline. */
const OFFLINE_RECHECK_MS = 30_000;

/**
 * GIS `error_callback` types that mean "the popup never got its chance", NOT
 * "the grant is gone". A background renewal is exactly the context in which a
 * browser blocks a popup, so treating these as auth loss signs out a perfectly
 * authorised user.
 */
const TRANSIENT_GIS_CODES = new Set(['popup_closed', 'popup_failed_to_open']);

/** `true` only when the browser positively reports no connectivity. */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** `true` when the tab is in the foreground (or there is no document at all). */
function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** Run `fn` the next time the tab becomes visible. Returns a canceller. */
function whenVisible(fn: () => void): () => void {
  if (typeof document === 'undefined') {
    fn();
    return () => {};
  }
  const onChange = (): void => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onChange);
    fn();
  };
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** Classify a thrown renewal error. See {@link RefreshOutcome}. */
export function classifyRefreshError(err: unknown): 'transient' | 'auth-lost' {
  if (err instanceof GisFlowError) {
    const { code } = err;
    // A blocked or closed popup is the browser's doing, not Google's refusal.
    if (typeof code === 'string' && TRANSIENT_GIS_CODES.has(code)) return 'transient';
    // `prompt: 'none'` failing any other way means interaction is required,
    // i.e. the silent grant is genuinely no longer usable.
    return 'auth-lost';
  }
  // Network error, GIS script that never loaded, anything unrecognised:
  // assume recoverable rather than bounce the user to /login.
  return 'transient';
}

export interface TokenRefreshOptions {
  /** Invoked after auth is lost — Google refused the renewal. */
  onAuthLost?: () => void;
  /**
   * Invoked when a renewal SUCCEEDS but comes back without the Drive
   * App Folder scope — the user removed access at myaccount.google.com. The
   * session stays (the token still identifies them, and every screen works
   * offline), but sync is dead until they re-consent, and nothing else would
   * say so until some later Drive call failed on something unrelated-looking.
   */
  onScopeNarrowed?: () => void;
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
 * SCOPE NARROWING — a renewal can succeed while granting less than it used to
 * (access removed at myaccount.google.com). Unlike my-diary, HourTrack does not
 * end the session over it: the app is fully usable on local data and the token
 * still identifies the user. It just has to SAY so, or the user keeps seeing a
 * green "synced" dot over a Drive that is no longer being written.
 */
function reportScope(scope: string, options: TokenRefreshOptions): void {
  if (!options.onScopeNarrowed) return;
  // An empty `scope` means Google echoed nothing back, not that it granted
  // nothing — don't cry wolf on it.
  if (scope.length === 0) return;
  if (scope.split(' ').includes(SCOPE_DRIVE_APPDATA)) return;
  options.onScopeNarrowed();
}

/**
 * Perform a single refresh attempt and persist the new tokens.
 *
 * Strategy:
 *   1. Prefer the refresh-token grant when a token is present.
 *   2. Fall back to silent re-auth (`prompt: 'none'`) when no refresh token
 *      exists OR the refresh-token grant fails.
 *   3. Verify the renewed grant still belongs to the same account and still
 *      carries the Drive scope.
 *
 * Exported for unit testing — `start()` calls this on each timer tick.
 */
export async function performRefresh(options: TokenRefreshOptions = {}): Promise<RefreshOutcome> {
  const current = await getTokens();
  // Already signed out (another tab, the profile menu). Nothing to renew and
  // nothing lost — the token store has already told the app.
  if (!current) return 'transient';

  // Path A: refresh-token grant.
  if (current.refreshToken) {
    try {
      const res = await refreshAccessToken(current.refreshToken);
      await setTokens({
        accessToken: res.access_token,
        accessTokenExpiresAt: Date.now() + normalizeExpiresIn(res.expires_in) * 1000,
        // Some Google responses omit refresh_token on subsequent refreshes;
        // keep the existing one when so.
        refreshToken: res.refresh_token ?? current.refreshToken,
        idToken: res.id_token ?? current.idToken,
        scope: res.scope || current.scope,
      });
      reportScope(res.scope || current.scope, options);
      return 'refreshed';
    } catch (err) {
      // Never fatal on its own — Path B is the flow that actually decides.
      console.warn('[tokenRefresh] refresh_token grant failed, attempting silent re-auth', err);
    }
  }

  // Path B: silent re-auth via GIS `initTokenClient` with `prompt: 'none'`.
  // This flow does NOT return refresh_token or id_token — we carry the
  // previous values forward so nothing downstream that depends on them
  // (e.g. cached identity, future refresh-grant attempts) regresses.
  let res;
  try {
    res = await silentReauth(current.email ?? undefined);
  } catch (err) {
    const outcome = classifyRefreshError(err);
    console.warn('[tokenRefresh] silent re-auth failed —', outcome, err);
    return outcome;
  }

  // ACCOUNT SWITCH — `hint` is a preference, not a constraint: if the browser's
  // Google session has moved to another account, `prompt: 'none'` happily
  // returns a token for THAT account. Writing it over the current row would
  // silently point Drive sync at a stranger's App Folder, so treat it as auth
  // loss and make the user sign in deliberately.
  if (current.email) {
    let renewedEmail: string | null = null;
    try {
      renewedEmail = (await getUserInfo(res.access_token)).email ?? null;
    } catch (err) {
      // Couldn't verify — a network problem, not evidence of a switch. The
      // token was requested with `hint`, so keep it and move on.
      console.warn('[tokenRefresh] could not verify the renewed account', err);
    }
    if (renewedEmail !== null && renewedEmail !== current.email) {
      console.warn('[tokenRefresh] silent re-auth returned a different account');
      return 'auth-lost';
    }
  }

  await setTokens({
    accessToken: res.access_token,
    accessTokenExpiresAt: Date.now() + normalizeExpiresIn(res.expires_in) * 1000,
    refreshToken: current.refreshToken,
    idToken: current.idToken,
    scope: res.scope || current.scope,
  });
  reportScope(res.scope || current.scope, options);
  return 'refreshed';
}

/**
 * Start the refresh loop. Returns a disposer that stops the loop and cancels
 * the next pending timer.
 */
export function startTokenRefresh(options: TokenRefreshOptions = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelVisibilityWait: (() => void) | null = null;
  let stopped = false;
  /** Consecutive transient failures — drives the backoff, never a sign-out. */
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
    // Offline hold — see the module docblock. No attempt, no backoff spent.
    if (isOffline()) {
      armIn(OFFLINE_RECHECK_MS);
      return;
    }
    // Hidden-tab hold — don't pop a Google window over another app. The
    // deferral replaces the timer, so nothing is lost if the tab stays hidden
    // for hours; the token is renewed the moment the user comes back.
    if (!isVisible()) {
      cancelVisibilityWait = whenVisible(() => {
        cancelVisibilityWait = null;
        void tick();
      });
      return;
    }
    // Signed out from elsewhere (another tab, the profile menu) — nothing to
    // renew, and no `onAuthLost` to fire: the token store already told the app.
    const current = await getTokens();
    if (stopped) return;
    if (!current) return;

    const outcome = await performRefresh(options);
    if (stopped) return;

    if (outcome === 'refreshed') {
      failures = 0;
      await schedule();
      return;
    }

    if (outcome === 'transient') {
      // A drop in connectivity mid-attempt is an offline hold, not a failure.
      if (isOffline()) {
        armIn(OFFLINE_RECHECK_MS);
        return;
      }
      failures += 1;
      // The last entry repeats indefinitely: a transient failure never runs
      // out of chances, it just stops getting more frequent.
      const backoff =
        RETRY_DELAYS_MS[Math.min(failures - 1, RETRY_DELAYS_MS.length - 1)] ?? MAX_RETRY_DELAY_MS;
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
    if (cancelVisibilityWait !== null) {
      cancelVisibilityWait();
      cancelVisibilityWait = null;
    }
  };
}
