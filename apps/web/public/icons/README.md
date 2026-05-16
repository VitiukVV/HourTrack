# PWA Icons

S19 regenerated the icon set from `icon-master.svg` (HT monogram on the
brand `#0F172A` background) using `@vite-pwa/assets-generator` with the
`minimal-2023` preset.

## Files

| File                       | Size    | Purpose                         |
| -------------------------- | ------- | ------------------------------- |
| `icon-master.svg`          | 512x512 | Source of truth (HT monogram)   |
| `favicon.svg`              | 512x512 | Browser tab icon                |
| `favicon.ico`              | 48x48   | Legacy browser fallback         |
| `pwa-192x192.png`          | 192x192 | PWA any-purpose                 |
| `pwa-512x512.png`          | 512x512 | PWA any-purpose                 |
| `pwa-maskable-512x512.png` | 512x512 | PWA maskable (Android adaptive) |
| `apple-touch-icon.png`     | 180x180 | iOS home-screen                 |

## Regeneration

Run from `apps/web/`:

```bash
pnpm dlx @vite-pwa/assets-generator --preset minimal-2023 public/icons/icon-master.svg
```

Then rename the generator's output to match the filenames the manifest
expects (the generator emits `maskable-icon-512x512.png` and
`apple-touch-icon-180x180.png`; the manifest references the legacy
`pwa-maskable-512x512.png` and `apple-touch-icon.png` names):

```bash
cd public/icons
cp -f maskable-icon-512x512.png pwa-maskable-512x512.png
cp -f apple-touch-icon-180x180.png apple-touch-icon.png
rm -f maskable-icon-512x512.png apple-touch-icon-180x180.png pwa-64x64.png
```

## Notes

- The maskable variant is generated with the `minimal-2023` preset's
  built-in 10% safe-area padding so the Android adaptive-icon crop
  (circle/squircle) doesn't clip the HT monogram.
- The apple-touch-icon is opaque (filled `#0F172A` background) — iOS
  does NOT add a background to a transparent apple-touch-icon and a
  transparent ring around the monogram on the home screen looks broken.
- `icon-master.svg` is the editable source. Always edit it, then re-run
  the generator. Do NOT hand-edit the generated PNGs.
