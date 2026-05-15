# Vercel Environment Variables -- HourTrack

> **Audience:** anyone deploying HourTrack to their own Vercel project.
> **Companion docs:** [`google-cloud-setup.md`](./google-cloud-setup.md),
> [`SELF_HOST.md`](./SELF_HOST.md).

HourTrack is a fully client-side PWA. The build needs exactly **one**
environment variable: the Google OAuth Client ID. Everything else
(Drive, Calendar, storage) is configured per-user at runtime via OAuth
consent — no API keys, no server secrets.

## Required variables

| Name                    | Required at | Value                                                                | Notes                                       |
| ----------------------- | ----------- | -------------------------------------------------------------------- | ------------------------------------------- |
| `VITE_GOOGLE_CLIENT_ID` | Build time  | `<digits>-<hash>.apps.googleusercontent.com` (your Web OAuth client) | Vite inlines `VITE_*` vars at `pnpm build`. |

Vite reads `VITE_*` variables at **build time**, not request time. If you
change the value in Vercel, you must **redeploy** for the new value to
take effect.

## How to set the variable in Vercel

### Via the Vercel dashboard

1. Open the Vercel project → **Settings** → **Environment Variables**.
2. Click **Add new**.
3. Name: `VITE_GOOGLE_CLIENT_ID`
4. Value: paste the Client ID from your Google Cloud Console OAuth client
   (see [`google-cloud-setup.md`](./google-cloud-setup.md)).
5. Environments: tick **Production**, **Preview**, **Development**.
   - HourTrack is a self-hosted personal tool; all three environments
     can share the same Client ID. Authorized origins on the Google
     side cover localhost (5173) AND your Vercel domain (production +
     preview wildcard) — see the post-deploy step in
     `google-cloud-setup.md`.
6. Click **Save**.
7. Trigger a redeploy (push a commit, or **Deployments** → latest →
   **Redeploy**).

### Via the Vercel CLI

```bash
vercel link              # one-time, links the local repo to the project
vercel env add VITE_GOOGLE_CLIENT_ID
# Paste value, then pick Production / Preview / Development.
vercel --prod            # redeploy production
```

## Verifying the value made it into the build

1. Open the deployed site (`https://<your-project>.vercel.app`).
2. Navigate to **/login**.
3. Click **Sign in with Google**.
4. The OAuth consent screen should show your app name (configured in the
   Google Cloud Console consent screen) and request the three documented
   scopes (`openid email profile`, `calendar.app.created`, `drive.appdata`).

### If the OAuth screen does NOT appear

`getGoogleClientId()` (`apps/web/src/lib/google/config.ts`) returns
`null` when the env var is missing OR equals the literal placeholder
string `your-client-id-here.apps.googleusercontent.com`. In that case
`LoginPage` renders a friendly "OAuth not configured" message instead
of attempting the flow. Common causes:

- The variable name is misspelled (Vite requires the `VITE_` prefix).
- The env var was added but the latest deployment predates the change
  (no redeploy after edit).
- The Vercel **Preview** environment is missing the variable. Preview
  builds use Preview env vars, not Production ones.

To confirm: in Vercel **Deployments** → click the deployment →
**Build Logs**. The Vite build prints which mode it ran in; the actual
inlined value is in the built JS chunk under `dist/assets/index-*.js`
(search for `googleusercontent.com`). If the literal placeholder
appears in the bundle, the env var is not flowing through.

## What is NOT required

HourTrack does NOT need:

- Database connection strings (everything lives in IndexedDB locally +
  the user's own Google Drive).
- Server API keys (no server).
- Any Google API key — OAuth Client ID is sufficient. The PWA uses GIS
  (Google Identity Services) for auth + the user's access token for
  Drive and Calendar calls. No service account, no API-key Google
  console product.
- A Sentry / analytics DSN. (None of those are wired into v1.0.0. If
  you add them in your fork, document the additional env var here.)

## Per-environment Client IDs

If you want production and previews to use **different** Google OAuth
clients (so previews don't share consent grants with production):

1. Create a second OAuth client in Google Cloud Console (same project,
   different name — e.g. `HourTrack PWA (preview)`).
2. Set its Authorized JavaScript origins to the Vercel preview wildcard
   (`https://*-<your-project>.vercel.app`) — note Google only accepts
   wildcards in subdomain position.
3. In Vercel, set `VITE_GOOGLE_CLIENT_ID` differently per environment:
   Production → prod client ID; Preview → preview client ID.

The v1.0.0 documentation assumes a single shared Client ID across all
environments — this is the simplest setup for a personal tool. The
per-environment split is optional.

## Rotation

To rotate the OAuth Client ID (e.g. if you suspect the value was leaked
— note this is a public web client and the Client ID is intended to be
public; leaking it is low-risk):

1. Create a new OAuth client in Google Cloud Console.
2. Update `VITE_GOOGLE_CLIENT_ID` in Vercel.
3. Redeploy.
4. Delete the old OAuth client in Google Cloud Console.

Active users will be logged out (their access tokens were issued against
the old client ID). They will re-consent on next sign-in.
