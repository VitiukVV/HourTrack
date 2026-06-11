# S24 — Audit Improvements Plan

Source: full-project audit (2026-06-11) covering correctness, UI/UX, and architecture/tooling.
Branch: `audit/s24-improvements`. Each phase is one commit (or a small group of commits) and keeps
`lint`, `typecheck`, and `test` green.

## Phase 1 — UTC date parsing (correctness, HIGH)

Root cause: `new Date('YYYY-MM-DD')` parses as UTC midnight; west of UTC every date-only string
renders/iterates one day early. Tests only pass because CI pins TZ to Europe/Kyiv.

- [ ] `packages/shared-utils/src/date-range.ts` — all helpers accepting `Date | string` must parse
      strings with `parseISO` (local) instead of `new Date()`.
- [ ] `apps/web/src/lib/date.ts:20` — `formatDate` likewise.
- [ ] Add regression tests that run the helpers against a date-only string and assert local-day
      identity (document the TZ caveat).

Fixes: shifted `formatDate` output (DayPage, MonthView, WeekView, EntryEditor, pickers, backup UI);
month/week grids starting on the wrong weekday and dropping the last day of the range.

## Phase 2 — Monthly-rate consistency + small invariants (HIGH/MEDIUM)

- [ ] `DayPage.tsx`, `WeekView.tsx`, `WeekAgendaView.tsx` — route monthly non-custom entries through
      `monthlyEarningsPerEntry` (same model as EntryEditor/Reports) so day/week totals stop showing
      `0.00 EUR` next to non-zero per-entry shares.
- [ ] `features/sync/lwwMerge.ts` — stop hardcoding `schemaVersion: 2`; use
      `Math.max(local.schemaVersion, remote.schemaVersion)`. Update the `'2'` appProperties literals
      in `SyncManager.ts` / `bootstrap.ts` to the current version.
- [ ] `features/cards/cardSchema.ts` — require `defaultDurationMin >= 1` on submit so day-click can
      never create a 0-minute entry (which violates `entrySchema` and permanently fails the
      calendar-event queue row).

## Phase 3 — UI high-priority fixes (HIGH)

- [ ] `CardsHeader.tsx` — replace `window.confirm` for archive with the app's `ConfirmDialog`
      (same pattern as `ArchiveSection`); add `toast.error` on archive failure.
- [ ] `DayPage.tsx` — don't flash the "no entries" EmptyState while the day query loads.
- [ ] `DayPickerModal.tsx` — gate "no cards yet" copy on `cardsQuery.isSuccess`.
- [ ] `EntryEditor.tsx` (calendar-sync Retry) — replace the immediate unconditional success toast
      with "retry queued" + `toast.error` in the catch.
- [ ] `EntryChip.tsx` (bar variant) — increase mobile tap target (currently ~18px; the rest of the
      app enforces 44px).
- [ ] `App.tsx` — `Toaster` must follow the app theme (currently always light).

## Phase 4 — Sync engine (HIGH/MEDIUM)

- [ ] `SyncManager.ts` — schedule the next flush after `runFlush` completes when queue rows remain
      (`min(nextAttemptAt) - now`); re-run once when `flush()` was joined mid-flight. Today the
      documented 2s/4s/8s backoff never fires on its own.
- [ ] `handlers/calendarOps.ts` + `lib/db/queries.ts` — write sync bookkeeping
      (`syncStatus`/`syncError`/`googleEventId`) without bumping `updatedAt`, so LWW merge can't
      prefer stale bookkeeping copies over real content edits.
- [ ] `bootstrap.ts` / `SyncManager.ts` — after `applySnapshot`, invalidate `['entries']`,
      `['cards']`, `['settings']` so remote data appears without a local mutation.
- [ ] `AuthProvider.tsx` — bootstrap guard keyed on session, not on the access token (currently the
      full Drive bootstrap re-runs on every hourly token refresh).

Deferred (needs its own design pass): per-row merge in `applySnapshot` instead of clear-and-rewrite
(412 race can drop local writes made during a flush — M1 in the audit).

## Phase 5 — i18n, currency, accessibility (MEDIUM)

- [ ] Translation keys for hardcoded strings: dialog sr-only "Close", MonthPicker
      "Previous/Next year", EntryChip `aria-label="note"`, BackupSection "(pre-restore)",
      ColorPicker color names/"(legacy)".
- [ ] `lib/format.ts` — `formatEur(value, locale)` via `Intl.NumberFormat`; use in ReportsMetrics,
      ReportsTable, EntryChip, EntryEditor, DayPage.
- [ ] Pickers — drop invalid `role="grid"`/`gridcell` (no rows), use `aria-pressed`; remove
      `aria-selected` from plain buttons in WeekPicker.
- [ ] `CalendarHeader.tsx` — fake tabs → `role="group"` + `aria-pressed`.
- [ ] `EntryEditor.tsx` / `CardForm.tsx` — `aria-invalid` + `aria-describedby` wiring for errors.
- [ ] `switch.tsx`, `ToggleGroup.tsx` — 44px mobile touch targets; focus-visible ring on
      ToggleGroup; mislabelled Reports period group; CardsHeader menu aria-label.
- [ ] `WeekAgendaView.tsx` — distinct title/body keys for the week empty state.
- [ ] `Reports.tsx` — friendly localized error instead of `String(reportQuery.error)`.

## Phase 6 — Tooling / CI (MEDIUM)

- [ ] `scripts/check-bundle-size.mjs` + CI step — fail the build when the main chunk exceeds the
      500 KB budget documented in `docs/PERF_NOTES.md`.
- [ ] `.github/workflows/ci.yml` — Playwright e2e job (chromium project), report artifact on
      failure.
- [ ] `turbo.json` — drop `dependsOn: ["^build"]` from `lint`/`typecheck`/`test` (consumers resolve
      workspace packages from source).
- [ ] Remove the duplicated root `vercel.json` copy (keep the one matching the Vercel project root;
      note the decision in `docs/vercel-env-setup.md`).

## Backlog (not in this branch)

- Dependency upgrade sprint: TS 5.9, Vite 7 + plugin-react 5, Vitest 3, vite-plugin-pwa 1.x,
  i18next 25, zod 4. Coordinated bumps; do separately.
- Per-row LWW merge in `applySnapshot` (sync M1).
- ReportsTable virtualization above ~100 rows (`TableVirtuoso`).
- DayPage month-bounded query instead of full card history (`useEntriesByCardQuery`).
- Query-key factory `lib/queryKeys.ts`; decouple `cardsById` from range query results so card
  mutations stop invalidating all calendar ranges.
- Coverage reporting (`@vitest/coverage-v8`) + thresholds; test for `restoreFlow.ts`.
- Skeleton primitive for MonthView/Reports/EntryEditModal loading states.
- PWA manifest: localized name/description, theme-color per theme, reconsider portrait lock.
- Low-severity items from the audit reports (orphaned Calendar events on hard delete, UTC backup
  filename labels, ETag fallback warning, dead `monthlyEarningsForPeriod`, sort comparator
  extraction, ESLint type-aware config, `tsc -b` emit into dist, sticky offsets via CSS variable).
