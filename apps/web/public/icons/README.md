# PWA Icons

Per `sprints/S01.md` Task 12: icons are generated via `pwa-asset-generator` from `favicon.svg`.

## Required outputs

| File                       | Size    | Purpose                         |
| -------------------------- | ------- | ------------------------------- |
| `pwa-192x192.png`          | 192x192 | PWA any-purpose                 |
| `pwa-512x512.png`          | 512x512 | PWA any-purpose                 |
| `pwa-maskable-512x512.png` | 512x512 | PWA maskable (Android adaptive) |
| `apple-touch-icon.png`     | 180x180 | iOS home-screen                 |

## Generation command

Run from `apps/web/`:

```bash
pnpm dlx pwa-asset-generator public/icons/favicon.svg public/icons \
  --background "#0F172A" \
  --icon-only \
  --opaque false \
  --padding "10%" \
  --maskable
```

This generates the 4 PNG variants. The S01 spec marks branding/icons as **low priority**
-- the build succeeds without the PNGs (vite-plugin-pwa will warn but not fail).
Production deploy in S14 must run this step before publishing.

The SVG favicon is committed and used by `index.html` directly.
