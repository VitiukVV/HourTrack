# HourTrack E2E Tests (Playwright)

End-to-end tests for the four golden paths + a11y audit. Run against the
production `vite preview` build, NOT the dev server — the artefact under
test is the same one users get.

## Quickstart

```bash
pnpm e2e         # from repo root, or
pnpm --filter @hourtrack/web e2e
```

The Playwright config (`playwright.config.ts`) boots `pnpm build &&
pnpm preview --port 4173` automatically. First run downloads the Chromium
headless binary (~140 MB) — subsequent runs reuse it.

### Mobile-only run (S18 — iPhone 13 viewport)

The config registers TWO projects: `chromium` (desktop) and
`mobile-iphone-13` (iPhone 13 viewport, `390 × 844` CSS px,
3× DPR). The default `pnpm e2e` runs BOTH. Run mobile-only with:

```bash
pnpm -F web e2e --project=mobile-iphone-13
```

This is the fastest local feedback loop when iterating on the mobile-
specific surfaces (agenda view, bottom-sheet modals, ≥44px touch
targets). The mobile project shares the same fixtures + specs as
desktop — no separate suite, no separate spec files.

When a spec is desktop-only (e.g. `04-backup.spec.ts` exercises the
download attribute which behaves differently on iOS), tag it with
`test.skip(testInfo.project.name === 'mobile-iphone-13')` at the
top of the file.

## Layout

```
e2e/
├── README.md             ← this file
├── fixtures/
│   ├── auth.ts           ← seeds an authed session into IndexedDB
│   └── mockGoogle.ts     ← intercepts GIS + Drive + Calendar at the network
├── 01-onboarding.spec.ts ← Onboarding tour first-login flow
├── 02-day-page.spec.ts   ← Calendar day-click → entry create flow
├── 03-reports.spec.ts    ← Reports custom range total
├── 04-backup.spec.ts     ← Backup create + restore round-trip
└── 05-a11y.spec.ts       ← axe-core scan of 4 main routes
```

## Mocking strategy

Google APIs (GIS, Drive, Calendar) are intercepted at the **network**
layer via `page.route(...)`. We never hit `accounts.google.com` or
`googleapis.com` in tests. Each fixture spec wires the routes it needs
in `test.beforeEach` so the routes get cleared between specs.

The `mockGoogle.ts` helper exposes:

- `mockGisToken(page, token)` — intercepts the GIS code → token exchange
- `mockDriveApis(page, { existingFile? })` — intercepts Drive list/get/
  put/delete on the `appDataFolder` namespace
- `mockCalendarApis(page, { calendarId? })` — intercepts Calendar
  list/insert/patch/delete

Use them together in `beforeEach`:

```ts
test.beforeEach(async ({ page }) => {
  await mockGisToken(page);
  await mockDriveApis(page, { existingFile: false });
  await mockCalendarApis(page);
  await seedAuthedSession(page);
});
```

## Auth seeding

`fixtures/auth.ts` writes a synthetic `authTokens` row directly to
IndexedDB before navigation, so `AuthProvider` lands in the `authed`
branch on first render. No actual OAuth dance required.

## a11y testing

`05-a11y.spec.ts` uses `@axe-core/playwright` to scan each route.
Critical violations BLOCK; serious + moderate are reported as warnings
(via `test.info().attach(...)`). The threshold is intentionally lower
than "zero violations" because some color-contrast edge cases are
unavoidable with the shadcn defaults; we'll tighten over time.

## Adding a new test

1. Create `e2e/NN-feature.spec.ts`.
2. Import fixtures from `./fixtures/...`.
3. Write `test.beforeEach` that mocks every Google endpoint the
   feature touches.
4. Use `data-testid` selectors — every UI element under test should
   carry one. Never select by CSS class (brittle to Tailwind churn) or
   by visible text (breaks on i18n changes).

## Known issues

- Playwright CI integration (`.github/workflows/ci.yml` job) is
  **deferred to S14**. Per LOCAL-ONLY mode, this sprint only wires the
  local `pnpm e2e` script.
- Two-device convergence tests (S10 followup) are also deferred — they
  require running two browser contexts in parallel with separate
  IndexedDB stores, which the current fixture model doesn't yet handle.
