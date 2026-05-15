# Lighthouse Baseline -- HourTrack

> **How to use this doc:** fill in the **Local-build baseline** column
> after your first `pnpm build && pnpm preview` + Lighthouse run, then
> fill in the **Production baseline** column after your first deploy
>
> - Lighthouse against the live URL. Re-run quarterly (or whenever
>   dependencies / chunks change meaningfully) and append a new row to
>   the **History** table at the bottom.

## Targets (from sprint S14 acceptance criteria)

| Category       | Target      | Why                                         |
| -------------- | ----------- | ------------------------------------------- |
| Performance    | ≥ 90        | Fast first contentful paint on cold load    |
| Accessibility  | ≥ 95        | A11y is a core feature, not an afterthought |
| Best Practices | ≥ 95        | Security headers, no console errors, etc.   |
| SEO            | ≥ 90        | Basic meta tags, lang attribute, etc.       |
| PWA            | Installable | Manifest valid + SW registered + HTTPS      |

Hitting all five **on the local preview build** is the minimum bar
before shipping. Hitting all five **on the production deployment**
with cold cache is the v1.0.0 launch gate.

### S18 mobile targets (Task 0a / Task 14)

S18 adds **mobile-specific** Lighthouse acceptance bars on top of the
desktop targets above. These are measured at the **iPhone 13 viewport
emulation** preset (`--preset=perf --emulated-form-factor=mobile`):

| Category       | Mobile target | Note                                                  |
| -------------- | ------------- | ----------------------------------------------------- |
| Performance    | ≥ 85          | Slightly looser than desktop ≥90 — slow CPU emulation |
| Accessibility  | ≥ 95          | Same bar as desktop                                   |
| Best Practices | ≥ 95          | Same bar as desktop                                   |
| PWA            | Installable   | Same bar as desktop                                   |

## How to run

### Local preview build

```bash
pnpm -w build                # builds apps/web/dist
pnpm --filter @hourtrack/web preview --port 4173 &
# In another shell:
pnpm dlx lighthouse http://localhost:4173 \
  --view \
  --preset=desktop \
  --output=html \
  --output-path=./lighthouse-local.html
```

Or in Chrome DevTools → **Lighthouse** tab → **Analyze page load**.
Use the "Mobile" preset for a closer approximation of real-world
load conditions; "Desktop" is the easier number.

### Mobile (iPhone 13) audit -- S18

```bash
pnpm dlx lighthouse http://localhost:4173 \
  --emulated-form-factor=mobile \
  --output=html \
  --output-path=./lighthouse-mobile-home.html
pnpm dlx lighthouse http://localhost:4173/reports \
  --emulated-form-factor=mobile \
  --output=html \
  --output-path=./lighthouse-mobile-reports.html
```

### Production deploy

Same as above but point at the Vercel domain:

```bash
pnpm dlx lighthouse https://<your-project>.vercel.app \
  --view \
  --preset=desktop \
  --output=html \
  --output-path=./lighthouse-prod.html
```

Run **twice**: first with cleared cache + service worker (DevTools →
Application → Storage → Clear site data), then with the SW warm. The
second run is what users will experience on revisit; the first run
is what they experience on first visit.

## Baseline scores

| Category       | Target | Local-build baseline (cold) | Production baseline (cold) | Production baseline (warm SW) |
| -------------- | ------ | --------------------------- | -------------------------- | ----------------------------- |
| Performance    | ≥ 90   | _to be filled_              | _to be filled_             | _to be filled_                |
| Accessibility  | ≥ 95   | _to be filled_              | _to be filled_             | _to be filled_                |
| Best Practices | ≥ 95   | _to be filled_              | _to be filled_             | _to be filled_                |
| SEO            | ≥ 90   | _to be filled_              | _to be filled_             | _to be filled_                |
| PWA            | Yes/No | _to be filled_              | _to be filled_             | _to be filled_                |

> **Local-build baseline is NOT production performance.** The local
> preview server is single-process unminified Node, your CPU has zero
> contention with real internet latency, and there's no CDN. Treat
> local numbers as a regression gate (compare against previous local
> numbers), not as a prediction of what users see.

## S18 pre-sprint mobile baseline (Task 0a) — anchor at `43ef4f0`

> **Captured 2026-05-15** at commit `43ef4f0` (S17 merged tip,
> immediately before S18 work began).
>
> **Deviation flag:** the S18 sub-agent ran in a sandboxed CLI
> environment where headless Chromium for Lighthouse could not be
> launched reliably (no preview server boot + no `chrome-launcher`
> CLI access available). The baseline numbers below could NOT be
> auto-captured by the agent. The intent of Task 0a is preserved by
> recording the **commit SHA + measurement protocol** so a human on a
> normal machine can fill in the numbers post-merge and they remain
> directly comparable to Task 14 (post-sprint) numbers run against
> the S18-merged tip with the same protocol.
>
> **Protocol to fill the table below:**
>
> 1. `git checkout 43ef4f0`
> 2. `pnpm -w install && pnpm -F web build`
> 3. `pnpm -F web preview --port 4173 &`
> 4. Wait for "Local: http://localhost:4173/" log line.
> 5. For each route in [`/`, `/reports`]:
>    `pnpm dlx lighthouse http://localhost:4173<route> --emulated-form-factor=mobile --output=json --output-path=./baseline-pre-s18-<route>.json --only-categories=performance,accessibility,best-practices,pwa --quiet`
> 6. Extract scores: `node -e "const r=require('./baseline-pre-s18-home.json'); console.log(JSON.stringify({perf: r.categories.performance.score*100, a11y: r.categories.accessibility.score*100, bp: r.categories['best-practices'].score*100, pwa: r.categories.pwa?.score*100}))"`
> 7. Fill the table below.

| Route      | Perf                 | A11y      | Best Practices | PWA installable | Notes               |
| ---------- | -------------------- | --------- | -------------- | --------------- | ------------------- |
| `/`        | _pending manual run_ | _pending_ | _pending_      | _pending_       | iPhone 13 emulation |
| `/reports` | _pending manual run_ | _pending_ | _pending_      | _pending_       | iPhone 13 emulation |

## S18 post-sprint mobile audit (Task 14) — anchor after S18 commit

> **Run after S18 lands on `main`.** Follow the same protocol as Task 0a
> but check out the S18 commit (e.g. `git checkout main` once S18 is
> committed) and re-run.

| Route      | Perf      | A11y      | Best Practices | PWA installable | Delta vs Task 0a | Notes               |
| ---------- | --------- | --------- | -------------- | --------------- | ---------------- | ------------------- |
| `/`        | _pending_ | _pending_ | _pending_      | _pending_       | _pending_        | iPhone 13 emulation |
| `/reports` | _pending_ | _pending_ | _pending_      | _pending_       | _pending_        | iPhone 13 emulation |

> **Acceptance gate for S18:** Perf ≥85, A11y ≥95, Best Practices ≥95,
> PWA installable on both routes. If any metric regressed from Task 0a
> _and_ falls below target, identify the responsible S18 task and
> address before declaring V2 complete.

## Known levers (if a category falls below target)

### Performance

- **Bundle size:** open `apps/web/dist/stats.html` (auto-generated on
  every build by `rollup-plugin-visualizer`). The home-route bundle
  target is **< 250 kB gzip**. Post-S13 it sits at ~227 kB gzip; new
  heavy deps push this up.
- **Lazy chunks:** `/reports` is already split (recharts in its own
  chunk). If you add another heavy feature (PDF export, audio
  recording), lazy-route it too (`React.lazy` + `<Suspense>`).
- **Image weights:** the placeholder PWA icons are tiny zero-dep PNGs.
  If you replace them with real artwork, keep them under 50 kB each.
- **Fonts:** v1.0.0 ships **no custom fonts**. If you add Google
  Fonts, use `font-display: swap` + preload the WOFF2.

### Accessibility

- The Playwright E2E suite includes an **axe-core scan** of all four
  main routes — `pnpm e2e` is the pre-deploy gate. Critical
  violations BLOCK the test run.
- shadcn/ui primitives use Radix under the hood; native ARIA semantics
  are correct out of the box. Custom components (DayCell, CardChip)
  may need explicit `aria-label`s.

### Best Practices

- **CSP** is set via `vercel.json` headers. If you load an additional
  third-party (e.g. Sentry), update the `connect-src` and `script-src`
  directives. Browsers flag CSP violations in the console + Lighthouse
  catches them.
- **HTTPS** is automatic on Vercel.
- **No mixed content** — all third-party endpoints HourTrack hits
  (`accounts.google.com`, `oauth2.googleapis.com`,
  `openidconnect.googleapis.com`, `www.googleapis.com`) are HTTPS.

### SEO

- The app is **noindex by default for a personal tool** — but
  Lighthouse's SEO score doesn't penalize that, it scores meta tags
  (`<title>`, `<meta name="description">`, `<html lang>`). The HTML
  shell in `apps/web/index.html` ships all three.
- If you make the deployment public-facing (e.g. as a demo), add
  a `<meta name="description">` to `index.html` and a per-route
  title via `useEffect(() => { document.title = ... })`.

### PWA

The installability checklist:

- `manifest.webmanifest` reachable (✅ set up by `vite-plugin-pwa`).
- Manifest declares: `name`, `short_name`, `start_url`, `display:
standalone`, two icons (192px + 512px). All wired in
  `vite.config.ts`.
- `display: standalone` — set.
- Service worker registered (`vite-plugin-pwa` injects this via
  `registerType: 'autoUpdate'` + `injectRegister: 'auto'`).
- HTTPS — automatic on Vercel.

If Lighthouse flags PWA as not installable, the usual cause is:

- Missing `apple-touch-icon` — fixed in `index.html` (`/icons/apple-touch-icon.png`).
- SW not registered (check DevTools → Application → Service workers).
- Manifest not reachable (404 on `/manifest.webmanifest` — fixed via
  the `vercel.json` `Content-Type` header).

## History

Append a new row each time you re-baseline. Keep the last 4 entries.

| Date       | Build                    | Perf | A11y | Best | SEO | PWA | Notes                                                |
| ---------- | ------------------------ | ---- | ---- | ---- | --- | --- | ---------------------------------------------------- |
| YYYY-MM-DD | v1.0.0 (local)           | --   | --   | --   | --  | --  | Fill in after first run                              |
| YYYY-MM-DD | v1.0.0 (prod)            | --   | --   | --   | --  | --  | Fill in after first deploy                           |
| 2026-05-15 | S18 anchor pre (43ef4f0) | --   | --   | --   | --  | --  | Task 0a — protocol-only, manual mobile audit pending |
