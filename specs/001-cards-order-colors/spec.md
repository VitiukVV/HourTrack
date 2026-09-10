# Feature Specification: Cards — user-defined order + richer colour choice

**Feature Branch**: `feature/cards-order-and-colors`

**Created**: 2026-09-10

**Status**: Draft

**Input**: User description (verbatim, from the app's user): "Додати можливість змінювати
порядок, щоб я ставила в тому порядку в якому я хочу. І додати ще кольорів або додати
можливість самостійно обирати кольори"

Source requirement document: `~/Downloads/hourtrack-cards-requirements.md`. The attached
screenshot showed the card header on a phone in dark theme: a horizontal row of
full-background rounded pills — Vacaciones (orange), Carlos (fuchsia), Anabel (violet),
a fourth pill clipped at the right edge — followed by the icon-only `+` button.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Put the cards in my own order (Priority: P1)

The user keeps several cards for the clients and activities she tracks. Today the row
presents them in an order she did not choose, so the cards she uses every day are not
necessarily the ones she reaches first. She wants to decide the order herself: move a
card to the front, group the ones that belong together, and leave the rarely used ones
at the end.

**Why this priority**: This is the first thing she asked for and it affects every day of
use — the card row is the entry point for logging time. Ordering is also independent of
the colour work and delivers value on its own.

**Independent Test**: Reorder cards in the header, reload the app, and confirm the row
still shows the chosen order; no colour work needed.

**Acceptance Scenarios**:

1. **Given** four cards in the header, **When** the user moves the last card to the first
   position, **Then** the row shows it first and the other three keep their relative order.
2. **Given** the user has set a custom order, **When** she closes and reopens the app,
   **Then** the row shows the same order.
3. **Given** the user is scrolling the card row horizontally on a phone, **When** she
   swipes across the pills, **Then** the row scrolls and no card changes position.
4. **Given** the user taps a card, **When** the tap ends without a reorder gesture,
   **Then** the card becomes the active card exactly as before this feature.
5. **Given** a custom order set on the phone, **When** the user opens the app on her
   other device after a sync, **Then** the second device shows the same order.

---

### User Story 2 - Choose a colour beyond the current twelve (Priority: P2)

The user distinguishes her cards by colour at a glance. She has used up the colours that
are easy to tell apart and wants either a larger set to pick from or the freedom to pick
a colour herself.

**Why this priority**: A real limitation she hit, but the app stays fully usable
meanwhile — cards can still be created, just with a repeated colour.

**Independent Test**: Create or edit a card, pick a colour that was not available before,
and confirm the pill, the calendar entries and the reports all show it.

**Acceptance Scenarios**:

1. **Given** the card editor is open, **When** the user opens the colour choice, **Then**
   she can select a colour that was not selectable before this feature.
2. **Given** a card with one of the twelve original colours, **When** the feature ships
   and she opens the app, **Then** the card still has exactly the colour it had.
3. **Given** a card with a newly available colour, **When** its entries are pushed to the
   connected calendar, **Then** the calendar events appear in a colour close to the card
   colour and no entry fails to sync.
4. **Given** a card with a newly available colour, **When** the user views the row in
   light and in dark theme, **Then** the card name stays legible on the pill in both.

---

### User Story 3 - One order everywhere cards are listed (Priority: P3)

Cards also appear outside the header — in the report filters, in the day entry picker, and
as the archived list in Settings. The user expects the order she set to be the order she
sees everywhere, instead of learning a different arrangement per screen.

**Why this priority**: Consistency polish; the ordering itself (P1) already delivers the
value she asked for.

**Independent Test**: Set a custom order in the header, then open the report filters and the
day entry picker and confirm both follow the same order.

**Acceptance Scenarios**:

1. **Given** a custom order, **When** the user opens the report filters, **Then** the cards
   are listed in that order — including when the filters are showing archived cards too.
2. **Given** a custom order, **When** the user opens the day entry picker, **Then** the
   cards are listed in that order.
3. **Given** several archived cards, **When** the user opens the archived list in Settings,
   **Then** they are listed by the same rule rather than arbitrarily.

---

### Edge Cases

- The user reorders cards on both devices before either syncs — the app must settle on
  one order deterministically rather than interleaving the two, and must not lose or
  duplicate a card.
- The user reorders while offline — the new order must survive until the next sync and
  then reach the other device.
- Only one card exists — the reorder affordance must not appear broken or block the tap.
- Many cards exist and the row scrolls — a card must be movable to a position that is
  currently off-screen.
- A card is archived and later restored — it must land in a defined position, not in an
  undefined slot.
- A newly created card must land in a defined position, not at a random place.
- The user picks a colour another card already uses — allowed, but the two pills become
  hard to tell apart; the app should not silently block it.
- A card carries a legacy colour that is no longer in the offered set — it must keep it
  and must remain editable.
- The user upgrades from the current version — nothing may change colour, and the first
  order she sees must match the order she saw before the upgrade.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to move a card to any position among their active cards
  from the card header row.
- **FR-002**: The chosen order MUST persist across app reloads and device restarts.
- **FR-003**: The chosen order MUST be part of the data that syncs between the devices of
  the user, and concurrent reorders on two devices MUST resolve to one deterministic
  order with no card lost or duplicated.
- **FR-004**: Reordering MUST work by pressing and holding a card until it visibly becomes
  draggable, then dragging it to its new position in the row — decided with the user,
  2026-09-10. The interaction MUST NOT interfere with the two existing gestures on the
  row: a short tap MUST still make the card active, and a horizontal swipe that starts
  before the hold completes MUST still scroll the row.
- **FR-014**: The app MUST give visible feedback for each phase of the reorder: that the
  hold has succeeded and the card is now draggable, where the card will land while it is
  being dragged, and that the new order has been kept once released.
- **FR-015**: Reordering MUST also be possible without a drag gesture, for keyboard and
  assistive-technology users.
- **FR-005**: Every place the app lists cards MUST present them in the order chosen by the
  user. Concretely, those places are: the card header row, the report filters (which may
  also include archived cards), the day entry picker, and the archived-cards list in
  Settings. There is no separate active-card management screen — the header row *is* that
  surface.
- **FR-006**: A newly created card MUST take a defined position in the order.
- **FR-007**: A card restored from the archive MUST take a defined position in the order.
- **FR-008**: Users upgrading from the current version MUST see, as their initial order,
  the same order the app showed them before the upgrade.
- **FR-009**: The colour choice MUST keep the existing twelve presets for a two-tap pick
  **and** add a custom-colour option that lets the user choose any colour herself —
  decided with the user, 2026-09-10.
- **FR-009a**: The app MUST keep the card label readable by choosing the label colour for
  the user: for any card colour it MUST render the label in whichever of its light or dark
  label colours actually contrasts more with that background, measured as a contrast ratio
  — decided with the user, 2026-09-10. This applies to preset and custom colours alike; see
  FR-010b for the consequence on existing cards.
- **FR-009c**: If a chosen colour is still below the readability threshold even with the
  better label colour, the app MUST say so next to the picker, and MUST still let the user
  keep that colour if she wants it.
- **FR-009b**: A custom colour the user has picked MUST be offered back to her the next time
  she edits that card — shown as the selected swatch and pre-filled in the colour entry — so
  she can keep it or fine-tune it without re-picking blindly.
- **FR-010**: Every card that exists before this feature ships MUST keep exactly the colour
  it has, with no repainting and no forced re-pick — with one deliberate exception below.
- **FR-010a**: The one preset that cannot reach the readability threshold with any label
  colour (the sky blue) MUST be corrected to a slightly deeper shade that does reach it,
  and cards currently holding the old value MUST be moved to the corrected shade — decided
  with the user, 2026-09-10, in full knowledge that this changes the appearance of those
  cards. No other card colour changes.
- **FR-010b**: Applying the label rule in FR-009a to the existing presets changes the label
  from light to dark on seven of them. This visible change is accepted deliberately in
  exchange for every card label being readable.
- **FR-011**: The readability required by FR-009a MUST hold in both light and dark theme —
  the label rule depends on the card colour alone, never on the active theme.
- **FR-012**: Every selectable colour MUST resolve to a colour for the events of the
  connected calendar; creating or editing an entry MUST NOT fail because the colour of a
  card has no exact calendar equivalent.
- **FR-013**: A card with a colour that is not in the offered set (legacy or previously
  custom) MUST keep that colour and MUST stay editable.

### Key Entities

- **Card**: the client or activity the user logs time against. Gains a notion of
  *position* relative to the other cards. Its *colour* is no longer restricted to twelve
  fixed values.
- **Card colour choice**: the set of colours the user may pick from, plus the rule that
  maps the colour of a card onto the limited colour set of the connected calendar.
- **Cross-device snapshot**: the synced representation of the data of the user; must carry
  both the card positions and any colour that is not one of the original twelve.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The user can move any card to any position in the row without opening a
  settings screen, and the result is visible immediately.
- **SC-002**: A custom order set on one device is identical on the other device of the
  user after one sync cycle, in 100% of trials.
- **SC-003**: When an existing user upgrades, the only card colour that changes is the sky
  blue corrected under FR-010a; every other card keeps its exact colour.
- **SC-004**: Every card label reaches at least a 4.5:1 contrast ratio against its pill
  background in both themes once the per-card label colour is applied; the rare colour
  that cannot reach it is flagged to the user at the moment she picks it.
- **SC-005**: Tapping a card still activates it in 100% of taps, and scrolling the row
  never reorders a card — measured across the touch interaction tests.
- **SC-006**: The user is never blocked by the colour set again: any colour she wants is
  reachable, while a common colour still takes at most two taps to pick.

## Assumptions

- A new card and a card restored from the archive are appended to the end of the order;
  the user can then move them where she wants (FR-006, FR-007).
- The initial order for existing users is the order the app currently produces, captured
  once at upgrade time, so the upgrade is visually a no-op (FR-008).
- A colour that has no exact equivalent in the palette of the connected calendar is mapped
  to the nearest available calendar colour rather than falling back to a default (FR-012).
- Order is a property of the data of the user, not of the device: both devices show the
  same order rather than each keeping a local arrangement.
- Archived cards are ordered among themselves and do not occupy positions in the active
  row.
- The hold that starts a reorder is short enough not to feel sluggish and long enough that
  a scroll or a tap never triggers it; the exact duration is a design detail for the plan.
- A colour the user picks herself is stored the same way a preset colour is, so a legacy
  colour outside the offered set behaves exactly like a custom colour (FR-013).
- Out of scope: earnings maths, entries, rate types, report contents, any app-wide
  re-theming, and sharing cards or colours between different accounts.
