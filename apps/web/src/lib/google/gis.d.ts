/**
 * Minimal ambient types for the Google Identity Services SDK
 * (`google.accounts.oauth2.*`). The SDK is loaded via a `<script>` tag in
 * `apps/web/index.html`; this declaration exists purely so TypeScript can
 * type-check our `gisClient.ts` wrapper.
 *
 * We only model the surfaces we actually call. The full SDK is much larger;
 * if a future sprint needs additional methods (e.g. `revoke`'s extended
 * callback shape, or `id` token APIs), extend this file rather than
 * scattering `@ts-ignore` comments.
 */

interface GisCodeClientConfig {
  client_id: string;
  scope: string;
  ux_mode: 'popup' | 'redirect';
  /** Required when `ux_mode === 'redirect'`. */
  redirect_uri?: string;
  /** Use PKCE: send `code_challenge` + `code_challenge_method`. */
  code_challenge?: string;
  code_challenge_method?: 'S256';
  /**
   * Internal-to-Google: signals popup mode wants the auth code returned to
   * the callback rather than opening a redirect.
   */
  callback: (response: GisCodeResponse) => void;
  /**
   * Optional `prompt`. Empty string = default. `'none'` requests silent
   * re-auth; `'consent'` re-prompts even when previously granted.
   */
  prompt?: '' | 'none' | 'consent';
  /** Hint for silent re-auth -- pass the cached ID token sub or email. */
  hint?: string;
  /**
   * Optional state value echoed back to the callback. We don't currently
   * use it (popup mode doesn't need CSRF protection the way redirect does),
   * but it's modelled for future use.
   */
  state?: string;
  error_callback?: (error: GisErrorResponse) => void;
}

interface GisCodeResponse {
  code: string;
  scope: string;
  state?: string;
  /**
   * Authuser index (Google account picker selection). Not consumed.
   */
  authuser?: string;
  hd?: string;
  prompt?: string;
}

interface GisErrorResponse {
  type: string;
  message?: string;
}

interface GisCodeClient {
  requestCode: () => void;
}

interface GisAccountsOAuth2 {
  initCodeClient: (config: GisCodeClientConfig) => GisCodeClient;
  /**
   * Revoke an access token / refresh token. Callback receives a response
   * object with `successful: boolean` and `error?: string`.
   */
  revoke: (
    token: string,
    callback: (response: { successful: boolean; error?: string }) => void,
  ) => void;
  hasGrantedAllScopes?: (...args: unknown[]) => boolean;
}

interface GisAccounts {
  oauth2: GisAccountsOAuth2;
}

interface Google {
  accounts: GisAccounts;
}

declare global {
  // The SDK attaches itself as `window.google.accounts.oauth2`.
  interface Window {
    google?: Google;
  }
}

export {};
