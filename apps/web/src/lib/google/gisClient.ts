import {
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  getGoogleClientId,
} from './config';
import { generateCodeChallenge, generateCodeVerifier } from './pkce';

/**
 * Thin wrapper over the Google Identity Services SDK
 * (`google.accounts.oauth2.*`) loaded from `accounts.google.com/gsi/client`
 * via the `<script>` tag in `apps/web/index.html`.
 *
 * Why a wrapper:
 *   - GIS callbacks are imperative — `requestCode` triggers a popup and
 *     resolves through a callback. Our consumers want Promises.
 *   - PKCE bookkeeping (verifier <-> challenge, token exchange) lives here so
 *     `LoginPage` only has to call `signIn()` and `await` it.
 *   - Centralizing the SDK shape makes mocking trivial in tests.
 *
 * Refresh-token caveat: Google's PKCE flow for browser public clients does
 * NOT reliably issue `refresh_token`. When the token response includes one,
 * we store it. When it doesn't, S09's `tokenRefresh` worker falls back to
 * silent re-auth via `prompt: 'none'`. See PROJECT_PLAN.md section 9.1 for
 * the locked decision.
 */

/** Result of a successful auth-code -> token exchange. */
export interface GoogleTokenResponse {
  access_token: string;
  /** Seconds until expiry. */
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
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
  constructor(message: string) {
    super(message);
    this.name = 'GisFlowError';
  }
}

/**
 * The dev (and prod) redirect URI for the OAuth code exchange. For popup mode
 * GIS doesn't use this for navigation, but Google's token endpoint requires
 * the same value that was registered in Cloud Console.
 */
export function getRedirectUri(): string {
  if (typeof window === 'undefined') return 'http://localhost:5173';
  // Use the page origin -- works for both `http://localhost:5173` (dev) and
  // `https://<vercel-domain>` (prod). Trailing slash is omitted to match the
  // Cloud Console convention.
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
 * if already ready; rejects after `timeoutMs` (default 8s). Used by
 * `LoginPage` so the "Sign in" button doesn't fire before the SDK loads.
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

/**
 * Returns `true` when env is configured and GIS is loaded.
 */
export function isSignInAvailable(): boolean {
  return getGoogleClientId() !== null && isGisReady();
}

/**
 * Request an authorization code via GIS popup, then exchange it at Google's
 * token endpoint using PKCE. Returns the token response or throws.
 *
 * `prompt` controls user experience:
 *   - `undefined`  -- normal sign-in flow with consent screen if needed
 *   - `'none'`     -- silent (no UI) — used by `tokenRefresh` on token expiry
 *   - `'consent'`  -- force re-prompt (rarely used)
 */
export async function signIn(options?: {
  prompt?: '' | 'none' | 'consent';
  hint?: string;
}): Promise<GoogleTokenResponse> {
  const clientId = getGoogleClientId();
  if (!clientId) throw new GisNotConfiguredError();
  await waitForGisReady();
  if (!isGisReady() || !window.google) throw new GisNotReadyError();

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  const code = await new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      ux_mode: 'popup',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: options?.prompt,
      hint: options?.hint,
      callback: (response) => {
        if (!response.code) {
          reject(new GisFlowError('GIS callback returned no auth code'));
          return;
        }
        resolve(response.code);
      },
      error_callback: (err) => {
        reject(new GisFlowError(err.message ?? err.type ?? 'GIS flow error'));
      },
    });
    client.requestCode();
  });

  // Exchange code for tokens at Google's token endpoint. PKCE: send
  // `code_verifier` so Google validates against the previously-sent
  // `code_challenge`.
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: getRedirectUri(),
  });

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GisFlowError(`Token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/**
 * Exchange a refresh token for a fresh access token. Returns the token
 * response. Throws `GisFlowError` on non-2xx (caller treats this as "fall
 * back to silent re-auth via `prompt: 'none'`").
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
 * Revoke an access or refresh token server-side. Wraps the GIS callback in a
 * Promise. Best-effort: the network call may fail (offline, etc.) but the
 * caller's local-state clear should proceed regardless.
 */
export async function revoke(token: string): Promise<void> {
  // Prefer the SDK's revoke if available -- it's slightly more lenient than
  // raw POST in some browsers. Fall back to plain fetch otherwise.
  if (isGisReady() && window.google) {
    await new Promise<void>((resolve) => {
      window.google!.accounts.oauth2.revoke(token, (response) => {
        // Always resolve -- revoke is best-effort and we don't want a failed
        // server-side revoke to block the local sign-out.
        if (!response.successful) {
          // Keep a console signal for debugging; don't throw.
          console.warn('[gis] revoke reported failure', response.error);
        }
        resolve();
      });
    });
    return;
  }
  // Fallback: hit the revoke endpoint directly.
  try {
    await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    });
  } catch (err) {
    console.warn('[gis] revoke fallback fetch failed', err);
  }
}
