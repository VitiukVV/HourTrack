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

| Date       | Build          | Perf | A11y | Best | SEO | PWA | Notes                      |
| ---------- | -------------- | ---- | ---- | ---- | --- | --- | -------------------------- |
| YYYY-MM-DD | v1.0.0 (local) | --   | --   | --   | --  | --  | Fill in after first run    |
| YYYY-MM-DD | v1.0.0 (prod)  | --   | --   | --   | --  | --  | Fill in after first deploy |
