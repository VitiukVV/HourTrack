# Implementation Plan: Pinned Payments header, card filter above the Reports title

**Spec**: `specs/012-sticky-headers-screenshot/spec.md` · **Branch**: `feature/sticky-payments-reports-chips`

## Design

Layout-only; no data, store or i18n-key changes besides the release notes.

**Payments (FR-001/002).** `PaymentsHeader`'s root gets the pinned-bar classes already used by
Reports: `bg-background sticky top-[var(--ht-sticky-chrome,0px)] z-10 border-b py-3`.
`--ht-sticky-chrome` is published by `AppLayout` from the measured top-bar height. The header is a
direct child of the page `<section>`, which also holds the rows, so it stays pinned for the whole
list. The MonthPicker popover is portalled, so the `z-10` doesn't clip it.

**Reports (FR-003/004).** `ReportsFilters` keeps both sections and their testids but renders the
card section first, then an optional `heading` slot (the page title from `Reports.tsx`), then the
pinned period section.

A sticky box only sticks inside its parent. Today the parent is the `reports-filters` wrapper,
so the bar unpins once the wrapper scrolls out. With the period section as the wrapper's last
child, it would not pin at all. So the wrapper becomes `display: contents` (`className="contents"`).
Its sections then join the page `<section>` flex column, and the bar stays pinned along the whole
report. The wrapper keeps `data-testid="reports-filters"` for the existing tests.

**Release.** Patch 1.10.1. Add `v1_10_1` in 3 locales. Rewrite the Payments and Reports guide
items in place so the item counts stay the same.

## Risks

- `display: contents` drops the wrapper's own box. Nothing styles that wrapper, and testids on
  `contents` elements still resolve in RTL/Playwright via their children.
- The Payments header now takes ~170px of pinned height on phones. The user chose this.

## Verification

Gate: `pnpm lint && pnpm typecheck && pnpm test`. Manual check on `localhost:5173` at phone
width:
- Payments with many rows → scroll → header pinned → › switches month.
- Reports → card row above the title → scroll → presets + picker pinned along the whole table.
