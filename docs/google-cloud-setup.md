# Google Cloud Console -- HourTrack OAuth Setup (Stub)

> **Status:** Stub introduced in S09. Final deployment steps land in S14.
>
> This document describes the manual Google Cloud Console steps required for the
> PWA's GIS PKCE flow to function. The app itself loads the GIS SDK from a
> `<script>` tag in `apps/web/index.html` (see `src="https://accounts.google.com/gsi/client"`),
> so no NPM package is required on the OAuth path — only the Cloud Console
> configuration below.

## Required steps

1. **Create a project** in [Google Cloud Console](https://console.cloud.google.com/).
   Name it `HourTrack` (or any label you prefer; only the project ID is
   referenced by the OAuth client).
2. **Enable APIs**:
   - Google Calendar API
   - Google Drive API
3. **Configure OAuth consent screen**:
   - User type: **External**
   - App name: `HourTrack`
   - Support email: your email
   - Developer contact: your email
   - Add yourself as a **test user** (Cloud Console -> "Test users") while the
     app is in unverified state. The PWA is a personal tool — verification is
     not required.
4. **Create OAuth 2.0 Client ID**:
   - Application type: **Web application**
   - Name: `HourTrack PWA`
   - Authorized JavaScript origins:
     - `http://localhost:5173` (dev)
     - `https://<your-vercel-domain>` (prod; added in S14)
   - Authorized redirect URIs:
     - `http://localhost:5173` (dev)
     - `https://<your-vercel-domain>` (prod; added in S14)
5. **Copy the Client ID** and set it as the environment variable:
   - Dev: copy `apps/web/.env.example` -> `apps/web/.env.local` and fill
     `VITE_GOOGLE_CLIENT_ID`
   - Prod: set the env var in Vercel project settings (S14)

## Scopes requested by HourTrack

Per `docs/PROJECT_PLAN.md` section 9.1, the PWA requests these scopes only:

- `openid` `email` `profile` (identity)
- `https://www.googleapis.com/auth/calendar.app.created` (S12 — only the
  app-created "HourTrack" calendar; no access to other calendars)
- `https://www.googleapis.com/auth/drive.appdata` (S10 — only the App Folder;
  invisible in the Drive UI)

The app deliberately does NOT request `auth/drive` (full Drive) or
`auth/calendar` (full Calendar). If a future feature needs them, add them here
AND update `apps/web/src/lib/google/config.ts`.

## Session model caveat (browser PKCE)

Google's auth-code flow with PKCE for browser-only public clients does not
reliably issue a long-lived `refresh_token`. HourTrack therefore relies on
**silent re-auth** via `prompt: 'none'` as the primary renewal mechanism: as
long as the user is signed into Google in the same browser, the access token
renews silently with no user interaction. If a `refresh_token` IS issued (some
client configurations do), it is stored in IndexedDB (Dexie `authTokens`
store) and used preferentially.

This is the explicit trade-off documented in PROJECT_PLAN.md section 9.1 —
"Variant B (pure PWA + Google Drive, no backend)".

## S14 finalization

The deployment sprint (S14) will:

- Add the production Vercel domain to authorized origins/redirect URIs
- Document the published Vercel URL in `README.md`
- Add a smoke test that verifies the OAuth flow round-trips in production
