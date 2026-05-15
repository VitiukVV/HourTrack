/**
 * Google OAuth configuration for the HourTrack PWA (S09).
 *
 * Scopes are deliberately the MINIMUM set required by the app per
 * `docs/PROJECT_PLAN.md` section 9.1:
 *
 *   - `openid email profile`               -- identity
 *   - `auth/calendar.app.created`          -- only the app-created HourTrack
 *                                              calendar (S12). NOT full
 *                                              `auth/calendar`.
 *   - `auth/drive.appdata`                 -- only the Drive App Folder (S10).
 *                                              NOT full `auth/drive`.
 *
 * If a future feature needs additional scopes, add them here AND in
 * `docs/google-cloud-setup.md` so users re-consent.
 *
 * The Google OAuth Client ID is read at runtime from
 * `import.meta.env.VITE_GOOGLE_CLIENT_ID`. When unset (e.g. dev without a
 * Cloud Console project) the `LoginPage` gracefully renders a "OAuth not
 * configured" message instead of attempting the flow.
 */

/** Identity scopes required for user-info fetch (name/email/picture). */
export const SCOPE_IDENTITY = 'openid email profile' as const;

/** Drive App Folder scope -- used by S10 SyncManager. */
export const SCOPE_DRIVE_APPDATA = 'https://www.googleapis.com/auth/drive.appdata' as const;

/** Calendar app-created scope -- used by S12 Calendar sync. */
export const SCOPE_CALENDAR_APP_CREATED =
  'https://www.googleapis.com/auth/calendar.app.created' as const;

/**
 * Space-separated scope string passed to GIS. ORDER MATTERS for some Google
 * SDKs (identity scopes first); keep `openid email profile` at the start.
 */
export const GOOGLE_SCOPES =
  `${SCOPE_IDENTITY} ${SCOPE_CALENDAR_APP_CREATED} ${SCOPE_DRIVE_APPDATA}` as const;

/**
 * Returns the OAuth Client ID from the Vite env, or `null` if unset/blank.
 *
 * Centralizing this in a function (rather than a constant) lets tests stub
 * `import.meta.env` safely and keeps the "no client ID" branch easy to
 * exercise: `LoginPage` calls `getGoogleClientId()` once on mount and renders
 * a friendly fallback if it returns `null`.
 */
export function getGoogleClientId(): string | null {
  const raw = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Reject the placeholder shipped in .env.example so a dev who forgot to
  // override it sees the "not configured" path instead of a confusing OAuth
  // error from Google.
  if (trimmed === 'your-client-id-here.apps.googleusercontent.com') return null;
  return trimmed;
}

/**
 * Google's OAuth token endpoint. Used only by `refreshAccessToken()` — the
 * `refresh_token` grant. The primary sign-in path uses GIS
 * `initTokenClient`, which `postMessage`s the access token directly to
 * the page and never hits this endpoint.
 */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token' as const;

/**
 * Google's token revocation endpoint. Used by `signOut(token)`.
 */
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke' as const;

/**
 * Google's user-info endpoint. Returns `{ sub, email, name, picture, ... }`.
 */
export const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo' as const;
