# Self-Host HourTrack — one-page checklist

> **Audience:** anyone forking HourTrack to run their own instance.
> **End-state:** a working `https://<your-project>.vercel.app` with the
> 1-minute first-entry path working for new users.
> **Time:** ~30 minutes end-to-end (first time). ~5 minutes from
> `git clone` to local dev. The 1-minute target is per-user
> **after** the deploy is live, not for the setup itself.

HourTrack is a personal-fork project. There is no public deployment
maintained by the original authors — every user runs their own.

## Prerequisites

- A Google account (the one that will own the OAuth client + receive
  Drive backups).
- A [Vercel](https://vercel.com) account (free tier is sufficient).
- A [GitHub](https://github.com) account (Vercel pulls from GitHub).
- Local toolchain:
  - **Node.js** `>=22`
  - **pnpm** `>=10`
  - **git** any recent version
- ~30 minutes the first time, ~2 minutes per redeploy thereafter.

## Steps

### 1. Fork & clone

```bash
# On GitHub: fork github.com/VitiukVV/HourTrack into your account.
git clone git@github.com:<your-username>/HourTrack.git
cd HourTrack
pnpm install
```

### 2. Google Cloud setup (one-time)

Follow [`docs/google-cloud-setup.md`](./google-cloud-setup.md)
steps **1 through 6**:

- Create a Google Cloud project.
- Enable Drive + Calendar APIs.
- Configure OAuth consent screen with the **3 documented scopes**.
- Add yourself as a test user.
- Create the OAuth Web Client ID.
- Copy the Client ID.

Leave the consent screen in **Testing** state (the default). The
"this app isn't verified" warning is normal and expected for a
personal fork — click **Advanced** → **Continue** when you encounter
it. Tokens expire weekly in Testing state; that's acceptable for a
personal tool.

### 3. Verify local dev works

```bash
cp apps/web/.env.example apps/web/.env.local
# Edit apps/web/.env.local and paste your Client ID:
#   VITE_GOOGLE_CLIENT_ID=<digits>-<hash>.apps.googleusercontent.com
pnpm dev
# Open http://localhost:5173. Click Sign in. Verify the OAuth flow
# round-trips and you reach the calendar with your name in the header.
```

If sign-in works locally, the rest is just hosting.

### 4. Push to your GitHub

```bash
git remote -v          # confirm origin points at YOUR fork
git push origin main
```

### 5. Connect Vercel to the repo

1. Go to [vercel.com/new](https://vercel.com/new).
2. Import the GitHub repository you just pushed to.
3. Vercel auto-detects the framework. Confirm:
   - **Framework Preset:** `Vite`
   - **Build Command:** `pnpm turbo run build --filter=@hourtrack/web`
     (set by repo-root `vercel.json`)
   - **Output Directory:** `apps/web/dist`
   - **Install Command:** `pnpm install --frozen-lockfile`
4. **Don't deploy yet** — set the env var first (next step).

### 6. Set `VITE_GOOGLE_CLIENT_ID` in Vercel

In the Vercel project settings → **Environment Variables**:

- Name: `VITE_GOOGLE_CLIENT_ID`
- Value: your Client ID
- Environments: **Production**, **Preview**, **Development**

See [`docs/vercel-env-setup.md`](./vercel-env-setup.md) for details.

### 7. Deploy

Click **Deploy**. Wait 2–3 minutes for the build to finish.

Note the URL Vercel assigned: `https://<your-project>.vercel.app`.

### 8. Add the production origin to your OAuth client

This is the post-deploy step from
[`docs/google-cloud-setup.md`](./google-cloud-setup.md#7-post-deploy-add-the-production-origin):

1. Google Cloud Console → **APIs & Services** → **Credentials**.
2. Open your `HourTrack PWA` OAuth client.
3. Add `https://<your-project>.vercel.app` to:
   - **Authorized JavaScript origins**
   - **Authorized redirect URIs**
4. Save. Wait ~5 minutes for propagation.

### 9. First sign-in (the 1-minute test)

Open `https://<your-project>.vercel.app/login` and time yourself:

- t+0:00 — Click **Sign in with Google**.
- t+0:15 — Consent screen appears (3 scopes listed).
- t+0:25 — Consent granted, redirect back to app.
- t+0:30 — Onboarding tour fires (3 steps).
- t+0:45 — Create your first card (e.g. "Project X", color green,
  hourly rate 50 EUR/h).
- t+0:55 — Click today on the calendar → entry created.

If all of the above happens in under 60 seconds, the **P4 acceptance
gate is met**. (Per `docs/IMPLEMENTATION_PLAN.md`: "Brand-new user
reaches their first logged entry within 1 minute of signup on
production Vercel deployment.")

### 10. Run the smoke test

Open [`docs/SMOKE_TEST.md`](./SMOKE_TEST.md) and walk through the
checklist. Tick each box as you go.

### 11. Tag the release

After the smoke test passes:

```bash
git tag -a v1.0.0 -m "HourTrack v1.0.0 (production self-host)"
git push origin v1.0.0
```

## Optional: PR-preview workflow

Vercel's GitHub integration automatically deploys a preview for every
PR you open. There is no GitHub Action required for previews — Vercel
runs its own builder.

If you want to **gate** merges on CI also passing (lint + typecheck +
test + build + E2E), drop this file at
`.github/workflows/deploy-preview.yml`. The HourTrack repo intentionally
ships **without** this workflow in v1.0.0 (LOCAL-ONLY pipeline mode —
you add it when you adopt the project to your team's flow):

```yaml
name: Preview gate

on:
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    name: Lint + Typecheck + Test + Build + E2E
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.8.1

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: i18n parity check
        run: pnpm i18n:check

      - name: Lint + Typecheck + Test + Build
        run: pnpm -w turbo run lint typecheck test build
        env:
          TURBO_TELEMETRY_DISABLED: 1
          VITE_GOOGLE_CLIENT_ID: ${{ secrets.VITE_GOOGLE_CLIENT_ID }}

      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('**/pnpm-lock.yaml') }}

      - name: Install Playwright Chromium
        run: pnpm --filter @hourtrack/web exec playwright install --with-deps chromium

      - name: Playwright E2E
        run: pnpm e2e
        env:
          VITE_GOOGLE_CLIENT_ID: ${{ secrets.VITE_GOOGLE_CLIENT_ID }}

      - name: Upload Playwright report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: apps/web/playwright-report/
          retention-days: 14
```

To use it:

1. In GitHub repo → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**:
   - Name: `VITE_GOOGLE_CLIENT_ID`
   - Value: your Client ID (it's a public web-client ID — safe to put
     in CI).
2. Save the YAML above as `.github/workflows/deploy-preview.yml`.
3. Push to a feature branch and open a PR — the workflow runs.
4. (Optional) In **Branch protection** for `main`, require the `ci`
   check to pass before merge.

## Troubleshooting

### "OAuth not configured" message at `/login`

The build was deployed without `VITE_GOOGLE_CLIENT_ID`. See
[`docs/vercel-env-setup.md`](./vercel-env-setup.md) →
"If the OAuth screen does NOT appear". Common causes:

- Variable name misspelled (must be exactly `VITE_GOOGLE_CLIENT_ID`).
- Variable added after the last deploy — redeploy needed.

### `redirect_uri_mismatch` after sign-in

The Vercel domain isn't on the OAuth client's allowlist. See step 8.

### Sign-in works but Drive/Calendar API calls 403

The OAuth consent screen is missing one of the three required scopes,
or the user revoked it. Re-run step 3 of
[`docs/google-cloud-setup.md`](./google-cloud-setup.md) and verify
**exactly three** scope groups are listed.

### Onboarding tour doesn't appear

This is expected for **returning** users — the dismissal is sticky.
To re-trigger for testing:

```js
// In DevTools console on the app:
(await indexedDB.databases()).find((d) => d.name === 'hourtrack');
// Then open the settings store via the DevTools Application tab,
// set `onboardingSeen = false`, reload.
```

Or sign in with a fresh Google account.

### Backup folder empty in Drive UI

Expected — HourTrack writes to the **invisible App Folder**
(`appDataFolder`). You can confirm files exist via Google's Drive API
explorer:

```
GET https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime,size)
```

See the "Backup format" section in [`README.md`](../README.md) for the
`DriveSnapshot v1` contract.

### Lighthouse score drops after deploy

Don't trust local-build Lighthouse numbers — the production deployment
runs over real network conditions and the SW caching warms up after
the first visit. Run Lighthouse against the production URL with
**clear cache** the first time, then again with cache to see the SW
benefit. See [`docs/lighthouse-baseline.md`](./lighthouse-baseline.md)
for the targets and how to record your numbers.

### Calendar API rate-limit (429)

Should not happen for personal use (per-100-seconds-per-user quota is
~6 000 read + ~600 write requests). If you see one, the SyncManager
back-off (2s → 60s) absorbs it transparently.

## Updating to a new HourTrack release

```bash
git fetch upstream             # if you added the upstream remote
git merge upstream/main
git push origin main
```

Vercel auto-deploys on push. The PWA service worker serves the new
build to existing users on the next page load (autoUpdate registration
mode — no user action required).

## Uninstalling

If you want to take down your deployment:

1. Vercel project → **Settings** → **Advanced** → **Delete project**.
2. Google Cloud Console → **APIs & Services** → **OAuth consent
   screen** → **Disable**.
3. Optional: revoke the OAuth client from
   `myaccount.google.com/permissions`.

Your local IndexedDB and the Drive App Folder contents are NOT
deleted by removing the deployment. To wipe Drive data:

- Visit `drive.google.com` → **⚙ Settings** → **Manage apps** →
  find "HourTrack" → **Options** → **Delete hidden app data**.
