# Stage 6 — Security review

**Scope**: `git diff main...HEAD` on `feature/cards-order-and-colors`, production
sources only (`apps/web/src`, `packages/*`, excluding tests), plus the dependency
change. Client-only PWA, no backend, single user, no auth surface of its own.

**Result: no findings.**

## Attack surface introduced by this feature, and why each is closed

### 1. Free-form colour string (the largest new input)

The feature stops restricting `Card.color` to 12 literals, so a user-supplied
string now reaches persistence, the DOM and the Calendar payload.

- **Validation is anchored and fixed-length at every boundary.**
  `isValidHexColor` is `/^#[0-9A-Fa-f]{6}$/` — no unbounded quantifier, so no
  ReDoS. It gates the form schema (`cardSchema.ts`), the DB defensive check
  (`assertCardShape`), and the snapshot ingest (`normaliseCardColor`, which
  repairs rather than accepts).
- **`ColorPicker` never emits an unvalidated value.** `commit()` calls
  `onChange` only when `isValidHexColor(next)`; the raw keystrokes live in
  `hexDraft`, which is never persisted. The hex field is `maxLength={7}`.
- **No CSS-injection sink.** The colour is only ever passed as a React
  `style={{ backgroundColor: value }}` object property, which React sets
  through the CSSOM — a malformed value is dropped by the browser, not
  concatenated into a stylesheet. There is no `cssText`, `insertRule`,
  `setAttribute('style', …)`, `<style>` interpolation, `innerHTML` or
  `dangerouslySetInnerHTML` anywhere in the diff.
- **Nothing free-form reaches Google.** `resolveCalendarColorId` maps the hex
  to one of Google's 11 fixed `colorId` strings (or `'8'`); the hex itself is
  never sent to the Calendar API.

### 2. Untrusted snapshot data (Google Drive `data.json`)

The v5→v6 in-band upgrade and the new `position` field parse a file the app
does not control.

- **No prototype pollution.** The upgrade builds new rows with object spread
  (`{ ...card, color, position }`), which defines own properties; it never uses
  `Object.assign`, bracket-assignment from an input key, or a recursive merge.
  `lwwMerge`'s new `localOnlyFields` fold is spread-based for the same reason.
  A `"__proto__"` key surviving `JSON.parse` stays an inert own property.
- **No unbounded work.** Every new code path is a bounded `map`/`sort` over the
  cards array; there is no `while` loop and no recursion. Rank renormalisation
  is a single pass over the active cards.
- **Hostile numbers are contained.** `position` is validated as
  `z.number().finite()`, `rankOf` maps a non-finite rank to `+Infinity` for
  display, and `updateCard` refuses a non-finite `position` patch — so a
  tampered file cannot produce a `NaN` comparator and an unstable sort.

### 3. Logging

New `console.error`/`console.warn` calls emit card ids (UUIDs) and colour
values only. No tokens, no Drive file contents, no user text.

### 4. Dependency

One addition: `@dnd-kit/sortable@10.0.0`, exact-pinned per
`docs/DEPENDENCY_POLICY.md`, integrity-hashed in `pnpm-lock.yaml`, and pulling
no transitive package that was not already in the tree
(`@dnd-kit/core`, `@dnd-kit/utilities`, `tslib`).

## Not changed by this feature

OAuth token handling, Drive/Calendar scopes, the service worker and the CSP are
untouched by this diff and were out of review scope.
