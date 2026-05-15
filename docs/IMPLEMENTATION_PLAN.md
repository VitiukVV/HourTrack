# HourTrack -- Implementation Plan

> **Status:** Sprint specs ready for APEX pipeline execution
> **Plan source:** [docs/PROJECT_PLAN.md](./PROJECT_PLAN.md)
> **Sprint specs:** [../sprints/](../sprints/)

## Pipeline Stages

| Phase | Name                     | Sprints | Key Deliverable                                                              |
| ----- | ------------------------ | ------- | ---------------------------------------------------------------------------- |
| P0    | Foundation               | S01-S02 | Monorepo + Vite/React/TS/Tailwind app skeleton + shared packages + Dexie     |
| P1    | Local MVP                | S03-S08 | Cards CRUD, calendar month/week, entries, DayPage, Reports, Settings (local) |
| P2    | Google Auth + Drive Sync | S09-S11 | GIS PKCE login, Drive `data.json` sync (LWW), manual + auto backup, restore  |
| P3    | Google Calendar Sync     | S12     | Calendar events create/update/cascade-delete + bulk PATCH + re-sync UI       |
| P4    | Polish + Deploy          | S13-S14 | Onboarding tour, empty states, perf, E2E, Vercel deploy, docs                |

## Critical Path

```
S01 -> S02 -> S03 -> S04 -> S05 -> S06 -> S07 -> S08 -> S09 -> S10 -> S12 -> S13 -> S14
                                           |
                                           +-> S11 (parallel-safe with S12 after S10)
```

**Longest chain (critical path):** S01 -> S02 -> S03 -> S04 -> S05 -> S06 -> S07 -> S08 -> S09 -> S10 -> S12 -> S13 -> S14 (13 sprints sequential).

**Parallel opportunity:** S11 (Backup) can run alongside S12 (Calendar sync) once S10 lands.

**Maximum-impact blockers (sprints with the most downstream consumers):**

- **S02** (shared-types + utils + Dexie) is used by every Phase 1+ sprint.
- **S09** (auth) unblocks all of P2/P3.
- **S10** (Drive sync) is the integration point for backups (S11) and calendar (S12) ops.

## Progress Tracker

| Sprint | Name                                                              | Type   | Phase | Size | Status | PR    | Deps               | Features                                                        |
| ------ | ----------------------------------------------------------------- | ------ | ----- | ---- | ------ | ----- | ------------------ | --------------------------------------------------------------- |
| S01    | Monorepo Skeleton + Web App Bootstrap                             | DEVOPS | P0    | L    | MERGED | local | None               | monorepo, vite, react, tailwind, shadcn, routing, i18n, pwa, ci |
| S02    | Shared Types + Shared Utils + Dexie DB Layer                      | FE     | P0    | M    | MERGED | local | S01                | shared-types, shared-utils, earnings, duration, dexie, date     |
| S03    | Cards CRUD + CardsHeader UI                                       | FE     | P1    | L    | MERGED | local | S02                | cards, card-form, color-picker, archive, active-card            |
| S04    | Calendar Month + Week Views                                       | FE     | P1    | L    | MERGED | local | S02, S03           | calendar-month, calendar-week, day-cell, navigation             |
| S05    | Active-Card Day-Click Create/Delete + No-Active-Card Modal        | FE     | P1    | M    | MERGED | local | S03, S04           | day-click, entry-create, entry-delete, no-active-card-modal     |
| S06    | DayPage + EntryEditor                                             | FE     | P1    | L    | MERGED | local | S03, S04, S05      | day-page, entry-editor, custom-payment, notes                   |
| S07    | Reports Page (Filters + Charts + Table + CSV)                     | FE     | P1    | L    | MERGED | local | S02, S03, S06      | reports, filters, charts, csv-export                            |
| S08    | Settings Page (Local) + Dark Theme + i18n Completeness            | FE     | P1    | M    | MERGED | local | S03, S07           | settings, theme, language, archive-section, mobile-tab-bar      |
| S09    | Google Identity Services (PKCE) + Login + Persistent Session      | FE     | P2    | L    | MERGED | local | S02, S08           | google-auth, pkce, token-refresh, login, profile                |
| S10    | Google Drive Sync (data.json + SyncManager + LWW + Offline Queue) | FE     | P2    | XL   | MERGED | local | S02, S09           | drive-sync, sync-manager, lww, offline-queue, tombstones        |
| S11    | Drive Backups (Manual + Auto Every 3 Days) + Restore              | FE     | P2    | M    | MERGED | local | S10                | backup, auto-backup, restore, rotation                          |
| S12    | Google Calendar Sync (Create/Update/Delete + Cascade + Re-sync)   | FE     | P3    | L    | MERGED | local | S09, S10           | calendar-sync, cascade-delete, bulk-patch, resync               |
| S13    | Onboarding Tour + Empty States + Performance + E2E Tests          | FE     | P4    | L    | MERGED | local | S08, S09, S10, S12 | onboarding, empty-states, lazy-load, virtualization, e2e        |
| S14    | Vercel Deploy + Google Cloud Setup Docs + README                  | DEVOPS | P4    | M    | MERGED | local | S13                | deploy, vercel, docs, google-cloud-setup, smoke-test            |
| S15    | Reports Cleanup + Entry-Row Table                                 | FE     | V2    | S    | MERGED | local | S13                | reports-cleanup, drop-recharts, entry-row-table, bundle-shrink  |

## Phase Acceptance Gates

Each phase must satisfy its acceptance criteria from [PROJECT_PLAN.md §10](./PROJECT_PLAN.md#10-implementation-phases-for-pipeline) before the next phase starts.

- **End of P0 (S02):** `pnpm dev` runs; routing skeleton renders in uk/en/es; Dexie schema initialized.
- **End of P1 (S08):** All 26 user requirements that do NOT require Google work locally (Dexie-only).
- **End of P2 (S11):** Two devices sync via Drive with LWW; auto-backup creates a snapshot every 3 days.
- **End of P3 (S12):** Entries appear/disappear in Google Calendar; rename card → events update; delete entry → event deleted.
- **End of P4 (S14):** Brand-new user reaches their first logged entry within 1 minute of signup on production Vercel deployment.

## Sprint Size Legend

- **XS** ~ 1-2h
- **S** ~ 2-4h
- **M** ~ 4-6h
- **L** ~ 6-9h
- **XL** ~ 9-12h

## Status Legend

- **PENDING** -- not started
- **IN_PROGRESS** -- sub-agent actively working
- **REVIEW** -- PR open, awaiting review / Copilot loop
- **MERGED** -- PR merged, sprint complete
- **BLOCKED** -- waiting on external dependency (rare)
