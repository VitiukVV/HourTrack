# Quickstart: validating cards order + colour

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

How to prove the feature works, end to end. Contracts and field rules are not repeated here —
see [contracts/](./contracts/) and [data-model.md](./data-model.md).

## Prerequisites

- Node 24.x, `pnpm install` at the repo root
- Dev server on **port 5173 only** — `strictPort` is set and only that origin is registered
  as an authorised JavaScript origin in Google Cloud, so any other port fails Google sign-in
  with `400 origin_mismatch`
- A signed-in Google account for the sync and Calendar checks; the local-only checks need no
  sign-in

## Automated gates

```bash
# unit + component, the fast loop
pnpm -F @hourtrack/web test

# the feature's own suites
cd apps/web
npx vitest run src/lib/colors.test.ts src/lib/db src/features/cards src/features/sync src/features/backup

# full gate, as the flow requires before each stage commit
cd ../..
pnpm lint && pnpm typecheck && pnpm test

# i18n parity — fails if a new key is missing from uk/en/es
pnpm i18n:check

# end-to-end, both projects (chromium + mobile-iphone-13)
pnpm e2e
```

## Manual validation — ordering

1. `pnpm dev`, open `http://localhost:5173`, and make sure at least four cards exist.
2. **Upgrade is invisible**: before pulling this branch, note the left-to-right order of the
   pills. After loading the branch, the order must be identical — the migration seeds
   positions from the order the app already showed.
3. **Reorder on desktop**: press a pill and drag more than 8px. It lifts, the neighbours make
   room, and dropping keeps the new order. Reload — the order persists.
4. **Tap still selects**: click a pill without moving. It becomes active (bordered, check
   icon) and nothing reorders.
5. **Reorder on touch**: in DevTools device emulation (or a real phone on the LAN), swipe the
   row horizontally — it scrolls, nothing moves. Then press and hold ~250ms — the pill lifts,
   and dragging repositions it.
6. **Keyboard**: Tab to a pill, press Space, move with Left/Right, press Space to drop. Press
   Escape mid-move to cancel. A screen reader announces the pick-up, each move and the drop.
7. **Consistency**: open Reports and the card management list — both show the same order.
8. **New and restored cards**: create a card (lands last), archive one and restore it from
   Settings (lands last).
9. **Cross-device**: reorder on device A, wait for the sync indicator to settle, then reload
   device B — same order. For the conflict case, take both devices offline, move a *different*
   card on each, then bring both online: both moves survive and every card appears once.

## Manual validation — colour

1. **Existing cards keep their colour**, with the one intended exception: a card that was sky
   blue `#0284C7` is now the corrected `#0C74B0`. Nothing else changes hue.
2. **Labels flip as decided**: orange, amber, banana, lime, basil and teal pills now carry
   dark text instead of white. This is the accepted consequence of the honest contrast rule
   (FR-010b) — verify it looks right rather than treating it as a regression.
3. **Custom colour**: edit a card, open the colour picker, choose the custom swatch, pick any
   colour (or type a hex). Save. The pill, the calendar entry chips and the reports rows all
   use it, and the label stays readable.
4. **Contrast warning**: pick a colour no label can rescue, such as mid-grey `#7F7F7F`
   (4.00:1 against the white label, 4.46:1 against the dark one — its best is still under
   4.5). The inline warning appears, and saving still works: it advises, it does not block.
   Note that a colour merely *looking* mid-tone is not enough — `#8899AA`, for instance,
   reaches 6.11:1 with the dark label and correctly stays silent.
5. **Re-editing keeps the custom colour**: reopen that card. Its colour is shown as the
   selected swatch, not silently reset to a preset.
6. **Calendar mapping**: with Google connected, create an entry on the custom-coloured card
   and open Google Calendar. The event is the nearest Google colour — not grey. Then change
   the card colour and confirm the existing events follow (the bulk PATCH already does this).
7. **Reorder does not touch Calendar**: with the network tab open, drag a card. No Calendar
   PATCH requests fire.

## Screenshot check

For the visual claims (label flips, drag lift, warning), decode the screenshot and measure
the pixels rather than eyeballing: read the pill's background and label colours directly and
compare them against the values in [contracts/card-colour.md](./contracts/card-colour.md).
