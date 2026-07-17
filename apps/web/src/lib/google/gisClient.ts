import {
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  getGoogleClientId,
} from './config';

/**
 * Thin wrapper over the Google Identity Services SDK
 * (`google.accounts.oauth2.*`) loaded from `accounts.google.com/gsi/client`
 * via the `<script>` tag in `apps/web/index.html`.
 *
 * Browser OAuth uses GIS `initTokenClient` (implicit-style popup flow). We
 * tried the auth-code + PKCE redirect flow first — both via GIS
 * `initCodeClient` and via a hand-built `accounts.google.com/o/oauth2/v2/auth`
 * URL — and Google's `/token` endpoint demanded `client_secret` in every
 * variant, ignoring `code_challenge`. That is Google's documented behavior
 * for "Web application" OAuth 2.0 Client IDs: PKCE without `client_secret`
 * isn't honored on the token endpoint regardless of how the auth-code
 * request was issued.
 *
 * `initTokenClient` bypasses `/token` entirely: Google's popup returns the
 * access_token directly to the page via `postMessage`. No auth-code, no
 * PKCE, no `client_secret` debate. The trade-off — no `refresh_token` —
 * is fine because the background `tokenRefresh` worker uses silent re-auth
 * (`prompt: 'none'`) as the renewal path anyway.
 */

/** Shape of a successful token-client callback. */
export interface GoogleTokenResponse {
  access_token: string;
  /** Seconds until expiry. */
  expires_in: number;
  scope: string;
  token_type: string;
  /**
   * `refresh_token` and `id_token` are never present for token-client
   * flows — kept optional in the type so callers that historically read
   * them just see `undefined`.
   */
  refresh_token?: string;
  id_token?: string;
}

/** Google user-info shape (OIDC). */
export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
}

export class GisNotReadyError extends Error {
  constructor() {
    super('Google Identity Services SDK is not ready (window.google.accounts.oauth2 is undefined)');
    this.name = 'GisNotReadyError';
  }
}

export class GisNotConfiguredError extends Error {
  constructor() {
    super('VITE_GOOGLE_CLIENT_ID is not configured');
    this.name = 'GisNotConfiguredError';
  }
}

export class GisFlowError extends Error {
  /**
   * The GIS `error_callback` `type` (e.g. `popup_closed`,
   * `popup_failed_to_open`) when the error originated there, otherwise
   * `undefined` (e.g. errors we synthesise for a missing `access_token`).
   * Callers use it to tell an expected user-cancellation apart from a real
   * failure — see {@link isUserCancelledSignIn}.
   */
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'GisFlowError';
    this.code = code;
  }
}

/**
 * `true` when the error represents the user dismissing the Google sign-in
 * popup rather than an actual failure — closing the window, or the popup
 * being blocked from opening. These are normal outcomes of an interactive
 * flow and should NOT surface as errors (no red toast, no `console.warn`).
 *
 * GIS reports these via `error_callback` with `type: 'popup_closed'` (user
 * closed it) or `type: 'popup_failed_to_open'` (blocked by the browser).
 */
export function isUserCancelledSignIn(err: unknown): boolean {
  return (
    err instanceof GisFlowError &&
    (err.code === 'popup_closed' || err.code === 'popup_failed_to_open')
  );
}

/**
 * Returns the origin we'll register as an Authorized JavaScript Origin in
 * Cloud Console. GIS uses `postMessage` from its popup back to this exact
 * origin, so any mismatch surfaces as a flow error.
 */
export function getRedirectUri(): string {
  if (typeof window === 'undefined') return 'http://localhost:5173';
  return window.location.origin;
}

/** Returns `true` once GIS has loaded and attached its API surface. */
export function isGisReady(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.google !== 'undefined' &&
    typeof window.google.accounts !== 'undefined' &&
    typeof window.google.accounts.oauth2 !== 'undefined'
  );
}

/**
 * Wait until GIS is ready, polling at 50ms intervals. Resolves immediately
 * if already ready; rejects after `timeoutMs` (default 8s).
 */
export function waitForGisReady(timeoutMs = 8000): Promise<void> {
  if (isGisReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (isGisReady()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new GisNotReadyError());
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

/** Returns `true` when env is configured and GIS is loaded. */
export function isSignInAvailable(): boolean {
  return getGoogleClientId() !== null && isGisReady();
}

/**
 * Request an access token via GIS `initTokenClient` (popup, implicit-style).
 *
 * `prompt`:
 *   - `undefined` / `''` — Google's default. Shows the consent screen on
 *     first use; subsequent calls within the same Google session reuse the
 *     grant. The usual interactive-sign-in choice.
 *   - `'none'` — silent re-auth. No UI; errors with `error_callback` if any
 *     interaction would be required. Used by `tokenRefresh`.
 *   - `'consent'` — always show the consent screen.
 */
export async function signIn(options?: {
  prompt?: '' | 'none' | 'consent';
  hint?: string;
}): Promise<GoogleTokenResponse> {
  const clientId = getGoogleClientId();
  if (!clientId) throw new GisNotConfiguredError();
  await waitForGisReady();
  if (!isGisReady() || !window.google) throw new GisNotReadyError();

  return new Promise<GoogleTokenResponse>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      prompt: options?.prompt,
      hint: options?.hint,
      callback: (response) => {
        if (response.error) {
          reject(
            new GisFlowError(
              `${response.error}${
                response.error_description ? ` — ${response.error_description}` : ''
              }`,
            ),
          );
          return;
        }
        if (!response.access_token) {
          reject(new GisFlowError('initTokenClient returned no access_token'));
          return;
        }
        resolve({
          access_token: response.access_token,
          expires_in: Number(response.expires_in) || 0,
          scope: response.scope ?? '',
          token_type: response.token_type ?? 'Bearer',
        });
      },
      error_callback: (err) => {
        reject(new GisFlowError(err.message ?? err.type ?? 'sign-in error', err.type));
      },
    });
    client.requestAccessToken();
  });
}

/**
 * Convenience wrapper for silent re-auth — equivalent to
 * `signIn({ prompt: 'none', hint })`. Kept as a separate export because
 * `tokenRefresh` mocks it independently and the call site reads better.
 */
export function silentReauth(hint?: string): Promise<GoogleTokenResponse> {
  return signIn({ prompt: 'none', hint });
}

/**
 * Exchange a refresh token for a fresh access token. Browser PKCE clients
 * rarely receive a `refresh_token` at all (and `initTokenClient` never
 * does), so in practice the `tokenRefresh` worker falls through to
 * `silentReauth`. This helper is retained for the (unlikely) case Google
 * issues one through some other path so callers don't have to
 * special-case its absence at the call site.
 */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const clientId = getGoogleClientId();
  if (!clientId) throw new GisNotConfiguredError();
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GisFlowError(`Refresh failed (${res.status}): ${text}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/**
 * Fetch the OIDC user-info endpoint with the access token. Used to populate
 * `Settings -> Profile` (avatar + email + name).
 */
export async function getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GisFlowError(`userinfo failed (${res.status}): ${text}`);
  }
  return (await res.json()) as GoogleUserInfo;
}

/**
 * Revoke an access or refresh token server-side. Best-effort: a failed
 * network call should not block local sign-out.
 */
export async function revoke(token: string): Promise<void> {
  if (isGisReady() && window.google) {
    await new Promise<void>((resolve) => {
      window.google!.accounts.oauth2.revoke(token, (response) => {
        if (!response.successful) {
          console.warn('[gis] revoke reported failure', response.error);
        }
        resolve();
      });
    });
    return;
  }
  try {
    await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    });
  } catch (err) {
    console.warn('[gis] revoke fallback fetch failed', err);
  }
}
