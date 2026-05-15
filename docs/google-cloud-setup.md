# Google Cloud Console -- HourTrack OAuth Setup

> **Audience:** anyone forking HourTrack and standing up their own
> deployment.
> **Time:** ~10 minutes for a fresh Google account.
> **Cost:** $0. Free tier covers personal use indefinitely.
>
> This document describes the manual Google Cloud Console steps required
> for the PWA's GIS PKCE flow to function. The app itself loads the GIS
> SDK from a `<script>` tag in `apps/web/index.html`, so no NPM package
> is required on the OAuth path -- only the Cloud Console configuration
> below.

## At a glance

You will:

1. Create a Google Cloud project.
2. Enable two APIs (Drive + Calendar).
3. Configure the OAuth consent screen with three scopes.
4. Create an OAuth 2.0 Web Client ID.
5. Add yourself as a test user (or submit for verification).
6. Copy the Client ID into your local `.env.local` and Vercel.
7. (Post-deploy) Add your Vercel domain to authorized origins.

---

## 1. Create a project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Project selector (top bar) → **New project**.
3. Name: `HourTrack` (or any label you prefer; only the project ID is
   referenced by the OAuth client).
4. Organization: **No organization** is fine for a personal account.
5. Click **Create**. Switch to the new project once it appears.

## 2. Enable APIs

In the new project:

1. Open **APIs & Services** → **Library**.
2. Search for and **Enable** each of these:
   - **Google Calendar API**
   - **Google Drive API**

You do NOT need to enable the People API, Gmail API, or any others.

## 3. Configure the OAuth consent screen

1. Open **APIs & Services** → **OAuth consent screen**.
2. User type: **External**. (Internal is only available for Workspace
   accounts.)
3. App information:
   - App name: `HourTrack`
   - User support email: your email
   - App logo: optional (skip for the personal-fork v1)
4. App domain: skip for now (only required for verification).
5. Developer contact information: your email.
6. Click **Save and continue**.

### Scopes (the critical step)

7. Click **Add or remove scopes**. Add exactly three scopes:

   | Scope                                                  | Purpose                                                  |
   | ------------------------------------------------------ | -------------------------------------------------------- |
   | `openid`                                               | Identity (issuer + subject)                              |
   | `https://www.googleapis.com/auth/userinfo.email`       | Identity (email — exposed via `email` scope alias)       |
   | `https://www.googleapis.com/auth/userinfo.profile`     | Identity (name + picture — exposed via `profile` alias)  |
   | `https://www.googleapis.com/auth/calendar.app.created` | Manage **only** the HourTrack calendar the app creates   |
   | `https://www.googleapis.com/auth/drive.appdata`        | Read/write **only** the app's invisible Drive App Folder |

   In the GIS scope string the identity triad is represented as the
   shorthand `openid email profile` (HourTrack ships exactly that
   string -- see `apps/web/src/lib/google/config.ts`). The consent
   screen UI lists them as the three URL-form scopes above.

   **Do NOT add** any of:
   - `https://www.googleapis.com/auth/drive` (full Drive — too broad)
   - `https://www.googleapis.com/auth/calendar` (full Calendar — too
     broad; would let the app touch the user's primary calendar)
   - `https://www.googleapis.com/auth/drive.file` (broader than App
     Folder — gives access to user-picked files)

   HourTrack deliberately requests the minimum-privilege scopes only.
   If you fork the project and add a feature that needs more scopes,
   update this document AND `apps/web/src/lib/google/config.ts` so
   users re-consent.

8. Click **Update** → **Save and continue**.

### Test users

9. Add yourself as a **test user**. While the app is in **Testing**
   status (default for new projects), only listed test users can sign
   in. This is fine for personal use.
10. Click **Save and continue** → **Back to dashboard**.

### Publishing status: Testing vs Verified

The OAuth consent screen sits in one of three states:

- **Testing** (default): only listed test users can sign in. Tokens
  expire after 7 days. **Recommended for personal forks.**
- **In production (unverified)**: anyone can sign in, but Google shows
  an "unverified app" warning before the consent screen. Tokens still
  expire after 7 days for sensitive scopes.
- **In production (verified)**: full Google trust badge. Requires a
  formal verification process with Google, including a public privacy
  policy, terms of service, and a CASA security assessment. **Not
  needed** for a personal-fork v1.

**Recommendation for a personal fork:** stay in **Testing**. Add the
two or three people you actually want to sign in as test users. Skip
verification entirely.

If you outgrow Testing later, the verification submission lives at
**OAuth consent screen** → **Publish app** → **Prepare for
verification**.

## 4. Create the OAuth 2.0 Client ID

1. Open **APIs & Services** → **Credentials**.
2. Click **Create credentials** → **OAuth client ID**.
3. Application type: **Web application**.
4. Name: `HourTrack PWA`.

### Authorized JavaScript origins

Add **exactly these origins** (no trailing slash, scheme matters):

| Environment   | Origin                                                             |
| ------------- | ------------------------------------------------------------------ |
| Local dev     | `http://localhost:5173`                                            |
| Local preview | `http://localhost:4173` (Vite preview / Playwright E2E)            |
| Production    | `https://<your-project>.vercel.app` (added **after** first deploy) |

> The production origin is added **after** the first Vercel deploy
> because you don't know the default domain until Vercel provisions it.
> See [step 7](#7-post-deploy-add-the-production-origin) below.

### Authorized redirect URIs

HourTrack does NOT use a server-side redirect URI. The sign-in flow is GIS
`initTokenClient` (implicit-style popup): Google's consent popup posts the
access token back to the parent window via `postMessage` — there is no
auth-code redirect to handle.

Google's Cloud Console UI nonetheless requires at least one entry in this
section before letting you save. Use the same values as JavaScript origins
above; they will simply never be hit at runtime:

- `http://localhost:5173`
- `http://localhost:4173`
- `https://<your-project>.vercel.app` (added after first deploy)

> **Why initTokenClient and not the auth-code + PKCE redirect flow?**
> Google's `/token` endpoint demands `client_secret` for "Web application"
> OAuth 2.0 Client IDs even when `code_challenge` is present — PKCE isn't
> honored as a public-client proof for this client type. Both popup-mode
> GIS (`initCodeClient`) and hand-built `accounts.google.com/o/oauth2/v2/auth`
> URLs hit the same wall. `initTokenClient` bypasses `/token` entirely:
> Google's popup `postMessage`s the access token back to the page, so the
> `client_secret` debate never arises. The trade-off — no `refresh_token`
> — is fine because the `tokenRefresh` worker renews via silent re-auth
> (`prompt: 'none'`).

5. Click **Create**.

A modal appears with the **Client ID** and **Client Secret**. **Copy
the Client ID.** You do NOT need the Client Secret for HourTrack —
PKCE replaces it for public browser clients.

## 5. Verify the consent screen lists exactly the required scopes

Open **APIs & Services** → **OAuth consent screen** → **Scopes** and
confirm the list shows exactly:

- `openid`
- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`
- `.../auth/calendar.app.created`
- `.../auth/drive.appdata`

If anything extra (e.g. `drive`, `drive.file`, `calendar`) appears,
**remove it**. Broad scopes will trigger a Google security review and
delay your ability to sign in.

## 6. Wire the Client ID into the app

### Local dev

```bash
cp apps/web/.env.example apps/web/.env.local
# Edit apps/web/.env.local:
#   VITE_GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
pnpm dev
```

### Production (Vercel)

See [`docs/vercel-env-setup.md`](./vercel-env-setup.md) — set
`VITE_GOOGLE_CLIENT_ID` in **Project Settings** → **Environment
Variables** for **Production**, **Preview**, and **Development**, then
redeploy.

## 7. Post-deploy: add the production origin

After your first Vercel deploy completes:

1. Note the default URL Vercel assigned. It is one of:
   - `https://<your-project>.vercel.app` (production)
   - `https://<your-project>-<hash>-<scope>.vercel.app` (preview /
     deployment-specific)

   You want the **production alias** — the short `<project>.vercel.app`
   form. The `Deployments` page shows it explicitly.

2. Go back to **Google Cloud Console** → **APIs & Services** →
   **Credentials** → click your `HourTrack PWA` OAuth client.

3. Under **Authorized JavaScript origins**, click **Add URI** and add:

   ```
   https://<your-project>.vercel.app
   ```

4. Under **Authorized redirect URIs**, add the same URI (the bare origin
   is fine — the field is never hit at runtime under `initTokenClient`,
   but Cloud Console refuses to save the client without at least one
   entry).

5. Click **Save**. Changes propagate in ~5 minutes.

6. Open `https://<your-project>.vercel.app/login` and verify the OAuth
   flow round-trips. The consent screen should list the three
   documented scope groups (Identity / Drive App Folder / HourTrack
   calendar).

> **Why this is a separate step:** Vercel provisions the default
> domain after the first build, and Google's OAuth client requires the
> exact origin in its allowlist (no wildcards in the apex form). This
> bootstrap order — deploy → discover URL → add to OAuth client —
> applies to every fresh fork.

### Custom domain (not v1.0.0)

If you later attach a custom domain in Vercel
(`Settings → Domains → Add`), add that domain too:

- `https://hourtrack.example.com`

Per the locked decision in `PROJECT_PLAN.md` section 3, HourTrack
v1.0.0 ships with the **default Vercel domain only**. Custom domains
are out of scope but the OAuth-client step above is the only change
needed if you decide to add one later.

### Vercel project rename

If you rename the Vercel project, the default `<project>.vercel.app`
domain changes. You must add the NEW domain to the OAuth client (and
optionally remove the old one). Until you do, the OAuth flow on the
new domain returns `redirect_uri_mismatch`.

## Common errors during setup

### `redirect_uri_mismatch`

Google's OAuth flow rejects the origin. Most likely cause: you opened
the app on `https://something.vercel.app` (preview deployment) but
only added the **production** origin to the OAuth client. Either:

- Open the production alias (`<project>.vercel.app`) directly, OR
- Add the preview URL explicitly to the OAuth client.

### `access_blocked` / "Error 403: access_denied"

Your account is not a listed test user, and the consent screen is in
**Testing** state. Add your email to the **Test users** list.

### "This app isn't verified" warning before consent

Expected when the consent screen is in **In production (unverified)**.
Click **Advanced** → **Go to HourTrack (unsafe)**. The warning goes
away when you publish for verification, which is **not required** for
personal use.

### `idpiframe_initialization_failed`

Usually means third-party cookies are blocked. HourTrack uses GIS's
new token model which doesn't depend on third-party cookies, so this
error is rare; check that the GIS script tag in `apps/web/index.html`
loaded (`https://accounts.google.com/gsi/client`).

### Tokens expire after 7 days

Expected in **Testing** state. Google force-expires tokens after 7
days for unverified apps. Users will need to sign in again roughly
weekly. To remove the cap, publish the consent screen and submit for
verification (overkill for a personal tool).

## Quotas

HourTrack's per-user usage is well under Google's defaults:

| API                | HourTrack pattern                            | Default quota per user |
| ------------------ | -------------------------------------------- | ---------------------- |
| Drive (App Folder) | ~1 read on bootstrap + ~1 write per mutation | 12k req / min / user   |
| Drive (backups)    | ~10 reads + ~10 writes / month               | 12k req / min / user   |
| Calendar           | 1 insert/patch/delete per entry mutation     | 600 req / min / user   |

For a single user managing dozens of entries per day, the per-100-seconds
per-user quota is never within reach.

## Scope summary (the codebase enforces this)

The string in `apps/web/src/lib/google/config.ts` is:

```ts
export const GOOGLE_SCOPES =
  `${SCOPE_IDENTITY} ${SCOPE_CALENDAR_APP_CREATED} ${SCOPE_DRIVE_APPDATA}` as const;
```

Which expands to:

```
openid email profile https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/drive.appdata
```

If the consent screen in your project lists more or fewer scopes than
this, the OAuth flow will either fail (asking for an unconfigured
scope) or silently grant overly broad access. Keep the consent screen
and the codebase in sync.

## Session model caveat (browser flow)

HourTrack uses GIS `initTokenClient` for both interactive sign-in and
silent renewal. The flow does not issue a `refresh_token`; renewal goes
through silent re-auth (`prompt: 'none'`) handled by the `tokenRefresh`
worker. As long as the user remains signed into Google in the same
browser, the access token renews with no user interaction. If Google's
session has expired, the worker clears local tokens and bounces the user
to `/login`.

Single API surface:

- **Interactive sign-in** — `signIn()` opens Google's consent popup. On
  success the popup `postMessage`s the access token back; no auth-code,
  no PKCE, no `/token` round-trip.
- **Silent re-auth** — `signIn({ prompt: 'none', hint })` (or the
  `silentReauth` convenience wrapper) reuses the same machinery without
  showing UI. Errors if interaction would be required, in which case the
  worker falls through to its auth-loss path.

This is the explicit trade-off documented in `PROJECT_PLAN.md` section
9.1 — Variant B (pure PWA + Google Drive, no backend).

## Next

After completing this guide:

- [`docs/vercel-env-setup.md`](./vercel-env-setup.md) — wiring the
  Client ID into Vercel.
- [`docs/SELF_HOST.md`](./SELF_HOST.md) — full one-page checklist from
  `git clone` to first entry in production.
- [`docs/SMOKE_TEST.md`](./SMOKE_TEST.md) — manual end-to-end checklist
  to run after each deploy.
