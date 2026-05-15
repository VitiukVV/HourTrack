# HourTrack Production Smoke Test

> **When to run:** after every release (`v1.x.y` tag pushed → Vercel
> deploys → smoke test).
> **Time:** ~5 minutes to walk through.
> **Environment:** real production `https://<your-project>.vercel.app`,
> NOT `localhost`.

This is the manual gate before declaring a deploy "good". If any
checkbox below fails, **rollback the deploy in Vercel** (Deployments →
previous good build → **Promote to Production**) and file an issue.

## Pre-flight

- [ ] **Vercel build green:** the most recent production deployment
      shows ✅ Ready in the Vercel dashboard.
- [ ] **Console clean on `/login`:** open
      `https://<your-project>.vercel.app/login`. DevTools console
      should have **zero red errors** before sign-in. (Warnings about
      autoplay or DevTools extensions are OK.)
- [ ] **PWA manifest reachable:** open `/manifest.webmanifest`
      directly. Returns 200 with `Content-Type:
    application/manifest+json`.
- [ ] **Service worker reachable:** open `/sw.js`. Returns 200 with
      `Cache-Control: public, max-age=0, must-revalidate`.

## 1. Authentication

- [ ] Click **Sign in with Google**.
- [ ] Google OAuth consent screen lists **exactly 3** scope groups:
  - Identity (`openid email profile`)
  - "See, edit, share, and permanently delete all the calendars you
    can access using Google Calendar" — **NO**: if you see this, the
    scope is wrong. Should be **"Make secondary Google calendars,
    and see, create, change, and delete events on them"** (the
    `.app.created` label).
  - "See, create, and delete its own configuration data in your
    Google Drive" (the `appdata` label).
- [ ] Grant consent. Redirect lands on `/` (calendar view).
- [ ] **Header shows your name + avatar.** (No "Sign in" button — that
      would mean auth didn't persist.)
- [ ] Refresh the page. Still signed in (no re-prompt).

## 2. Onboarding (first-time user only)

> Skip this section if you're a returning user. To re-trigger, see
> [`docs/SELF_HOST.md`](./SELF_HOST.md) → Troubleshooting → "Onboarding
> tour doesn't appear".

- [ ] Onboarding tour appears within 1s of first calendar view.
- [ ] Step 1 highlights the **+** button in the cards header.
- [ ] Step 2 advances when a card exists, hints "Create a card first"
      otherwise.
- [ ] Step 3 highlights today's day cell.
- [ ] **Skip** dismisses the tour and does not re-appear after
      reload. (Settings → `onboardingSeen` is true.)

## 3. Cards

- [ ] Click **+** in the cards header.
- [ ] Fill in: name `Smoke test`, color any, rate type `hourly`, rate
      `50 EUR/h`, default duration `2H 0M`.
- [ ] **Save.** Card chip appears in the header.
- [ ] Right-click the chip → context menu shows **Edit**, **Archive**.
- [ ] **Archive** → confirm dialog → chip disappears from header.
- [ ] Settings → **Archived cards** section shows the card →
      **Restore** brings it back.

## 4. Entry (the 1-minute path)

- [ ] Click the active card chip (it gets a ring border indicating
      "active").
- [ ] Click **today** on the month view.
- [ ] Day marker dot appears on that day cell.
- [ ] Click the day cell → DayPage opens at `/day/<YYYY-MM-DD>`.
- [ ] Entry row shows: card name, `2H 0M`, `100 EUR` (= 2h × 50).

> **Stopwatch check:** from clicking **Sign in** to seeing the entry
> on the DayPage, the full path should take **< 60 seconds** for a
> first-time user. (P4 acceptance gate.)

## 5. Reports

- [ ] Click **Reports** in nav.
- [ ] Default range = current month, all cards.
- [ ] Total card shows `2H 0M` and `100 EUR` (from the entry above).
- [ ] Pie chart renders (recharts loads from the lazy chunk).
- [ ] CSV export → file downloads with at least one row.
- [ ] Switch range to **Day** (today) → totals shrink to today's
      entry only.

## 6. Google Calendar sync

- [ ] Open `https://calendar.google.com` in another tab.
- [ ] Left sidebar shows a calendar named **"HourTrack"** (created on
      first sync).
- [ ] Today's date in Google Calendar has an event:
      `Smoke test | 2H 0M | 100 EUR`.
- [ ] Back in HourTrack: edit the entry (3H 0M) → wait 2s → refresh
      Google Calendar → event title now reads `3H 0M | 150 EUR`.
- [ ] Delete the entry in HourTrack → confirm → refresh Google
      Calendar → event is gone.

## 7. Drive backup

- [ ] HourTrack Settings → **Backup & Restore** → **Backup now**.
- [ ] Toast: "Backup created".
- [ ] Backup list updates (date stamp added).
- [ ] Open Drive API explorer:
      `https://developers.google.com/drive/api/reference/rest/v3/files/list`,
      authorize, run with `spaces=appDataFolder` →
      lists `data.json` + `backups/<timestamp>.json`.

## 8. Multi-device sync (optional, time permitting)

- [ ] Sign in on a second device (or a private window with the same
      Google account).
- [ ] Cards header shows the `Smoke test` card.
- [ ] Calendar shows today's entry (if you didn't delete it in step 6).
- [ ] Edit the entry's note on device A → wait 2s → refresh device B
      → note appears (LWW merge).

## 9. PWA install

- [ ] Chrome address bar shows the **install** icon (right side of
      URL bar).
- [ ] Click install → confirm. App opens in its own window.
- [ ] Re-open from OS app launcher. Loads instantly (SW cache).
- [ ] Go offline (DevTools → Network → Offline). Reload the app
      window. App loads and the calendar is interactive. (Mutations
      will queue and drain on reconnect.)
- [ ] Back online. Sync icon (if surfaced) shows queue draining.

## 10. i18n

- [ ] Settings → **Language** → switch to `English`. UI updates
      immediately. Dates still render `DD.MM.YYYY`.
- [ ] Switch to `Español`. UI updates.
- [ ] Switch back to `Українська`.
- [ ] No console errors about missing translation keys.

## 11. Sign out

- [ ] Settings → **Sign out**.
- [ ] Redirect to `/login`.
- [ ] Reload. Still signed out (no auto-restore).
- [ ] Sign back in. Onboarding tour does **NOT** re-appear.
- [ ] Cards + entries are restored from Drive (`data.json` pulled in
      bootstrap).

## Post-flight

- [ ] **Performance:** DevTools → Lighthouse → run audit against the
      production URL. Compare scores against
      [`docs/lighthouse-baseline.md`](./lighthouse-baseline.md). Record
      the new numbers in that file under "Production baseline".
- [ ] **Bundle size:** open `apps/web/dist/stats.html` from the local
      build (`pnpm build`) and confirm the home-route chunk is still
      under 250 kB gzip.
- [ ] **Error monitoring:** if you wired Sentry or similar (not in
      v1.0.0), check the last 10 minutes for new error spikes.

## Failure protocol

If any **bold** checkbox above fails:

1. **Rollback** the production deploy in Vercel:
   Deployments → previous Ready build → **Promote to Production**.
2. Open a GitHub issue with the failing step + browser/OS + a
   DevTools console screenshot.
3. Reproduce locally with `pnpm dev` (set the same env var). If it
   reproduces locally, fix and re-cut a release. If it only
   reproduces in production, suspect: env var typo / OAuth client
   misconfig / CSP header / SW cache from previous deploy.

## Notes

- This is a **manual** checklist by design. A future sprint could
  promote it to an automated Playwright run against production using
  a recorded fixture account, but that requires either a dedicated
  test Google account or service-account magic — both out of scope
  for v1.
- Run on **at least one Chromium** (Chrome/Edge) + **one Safari**
  (macOS or iOS) per release. Firefox is encouraged but not gated.
- The smoke test does NOT cover edge cases — it's a happy-path gate.
  Edge cases (offline-edit conflict, scope-revocation flow,
  multi-tab race) are covered by the unit + E2E suites pre-deploy.
