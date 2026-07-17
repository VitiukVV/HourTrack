# HourTrack

> Personal PWA for tracking work hours -- Google-only auth, Google Drive sync, Google Calendar integration.
> Trilingual UA / EN / ES. v1.1.0.

HourTrack is a self-hosted single-user PWA. Every fork runs its own
Google Cloud project, its own Vercel deployment, and stores data in
its owner's own Google Drive. There is no shared backend, no central
database, no telemetry leaving the user's browser.

## What is HourTrack?

A calendar-first work-hours tracker designed for freelancers and
contractors who work across multiple clients ("**cards**") and need:

- A glanceable calendar with markers on worked days (Google Calendar
  style).
- Per-day entry editing with custom payments, notes, and a card-level
  default duration.
- Reports by Day / Week / Month / Custom range — total hours, total
  earnings, per-card splits, entry-row table (Date / Project / Hours /
  Sum).
- Real Google Calendar integration: every entry is also an event in
  a dedicated "HourTrack" calendar that you can sync to your phone
  via the standard Google Calendar app.
- Real Google Drive backup: state lives in your **invisible** Drive
  App Folder (`appDataFolder`); manual backup button + automatic
  snapshot every 3 days; last 10 snapshots retained, oldest rotated.
- Offline-first: every action is local-first against IndexedDB; the
  sync queue drains on reconnect.

It is **not** a team product. There is no admin, no roles, no
sharing. One Google account = one HourTrack instance.

## Features

| Category | Capability                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| Calendar | Month / Week views. Click a day to add an entry under the active card. +N more → dedicated DayPage.         |
| Cards    | Name, color (12-preset palette), default duration, rate (`hourly` OR `fixed total`), default note.          |
| Entries  | Hours + minutes input. Custom payment override (bypasses hours × rate). Per-entry notes.                    |
| Auth     | Google OAuth 2.0 (PKCE). Persistent session via silent re-auth. Logout only via manual Settings.            |
| Sync     | Drive App Folder `data.json` with LWW merge. Offline queue with exponential back-off.                       |
| Backup   | Manual + auto (every 3 days). Restore from any snapshot in Settings.                                        |
| Calendar | Events created/updated/deleted in lockstep with entries. Cascade delete on entry delete.                    |
| Reports  | Filters (cards, date range). Metrics card + entry-row table (Date/Project/Hours/Sum). Show archived toggle. |
| PWA      | Installable. Service worker (Workbox). Works offline. Trilingual UA / EN / ES.                              |
| Privacy  | Three minimum-privilege scopes only: `openid email profile`, `calendar.app.created`, `drive.appdata`.       |

## Tech stack

| Layer            | Tool                                              |
| ---------------- | ------------------------------------------------- |
| Framework        | React 19 + Vite 8 + TypeScript 6                  |
| UI               | Tailwind CSS 4 + shadcn/ui (Radix) + Lucide icons |
| Server-state     | TanStack Query 5                                  |
| Client state     | Zustand 5                                         |
| Forms            | react-hook-form + zod                             |
| Dates            | date-fns 4 (Monday week start)                    |
| Local storage    | Dexie (IndexedDB)                                 |
| PWA              | vite-plugin-pwa (Workbox)                         |
| i18n             | i18next + react-i18next                           |
| Auth             | Google Identity Services (PKCE)                   |
| Drive / Calendar | `fetch` against Google REST v3 APIs               |
| Hosting          | Vercel (free tier, default domain)                |
| Monorepo         | pnpm 10 workspaces + Turbo 2                      |
| Code quality     | ESLint 9 (flat config) + Prettier + Husky         |
| Testing          | Vitest + React Testing Library + Playwright       |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              PWA (apps/web)                          │
│                                                      │
│  ┌──────────────┐         ┌──────────────────────┐  │
│  │  React UI    │ ↔       │   Dexie (IndexedDB)  │  │
│  └──────┬───────┘         └──────────┬───────────┘  │
│         │                            │              │
│  ┌──────▼────────────────────────────▼──────────┐   │
│  │   SyncManager  (queue + retry + LWW merge)    │   │
│  └──────┬──────────────────────────────┬────────┘   │
└─────────┼──────────────────────────────┼────────────┘
          │ Google Identity              │
          │ Services (PKCE)              │
          ▼                              ▼
   ┌──────────────┐              ┌─────────────────┐
   │ Google Drive │              │ Google Calendar │
   │   API v3     │              │    API v3       │
   │              │              │                 │
   │ appDataFolder│              │ Calendar:       │
   │  data.json   │              │  "HourTrack"    │
   │  backups/    │              │  events         │
   └──────────────┘              └─────────────────┘
```

Single deployment, single user, all state in the user's own Google
account. See [`docs/PROJECT_PLAN.md`](./docs/PROJECT_PLAN.md) §4 for
the full sync flow.

## Local dev quickstart

Requirements: Node `>=22`, pnpm `>=10`.

```bash
git clone <your-fork-url> && cd HourTrack
pnpm install

# Set your Google OAuth Client ID — see docs/google-cloud-setup.md
cp apps/web/.env.example apps/web/.env.local
# Edit apps/web/.env.local:
#   VITE_GOOGLE_CLIENT_ID=<digits>-<hash>.apps.googleusercontent.com

pnpm dev           # http://localhost:5173
```

If `VITE_GOOGLE_CLIENT_ID` is unset, the `/login` page renders a
friendly "OAuth not configured" screen instead of crashing.

## Self-host (deploy your own)

HourTrack is designed to be forked and self-deployed. Every fork
gets its own Google Cloud project + Vercel deployment.

See **[`docs/SELF_HOST.md`](./docs/SELF_HOST.md)** for the one-page
checklist. End-to-end first-deploy time is ~30 minutes (mostly
Google Cloud Console clicks).

The three supporting docs:

- **[`docs/google-cloud-setup.md`](./docs/google-cloud-setup.md)** —
  create the OAuth client + consent screen.
- **[`docs/vercel-env-setup.md`](./docs/vercel-env-setup.md)** —
  wire the Client ID into Vercel.
- **[`docs/SMOKE_TEST.md`](./docs/SMOKE_TEST.md)** — manual smoke
  checklist to run on every release.
- **[`docs/lighthouse-baseline.md`](./docs/lighthouse-baseline.md)** —
  Lighthouse targets + record your scores.

## Backup format

Backups are JSON snapshots stored in your Drive App Folder
(`spaces=appDataFolder`). The contract is **`DriveSnapshot` v5**. It grew
forward-only: v2 (S16) added time-bound fields (`Entry.startMinutes` +
`Card.defaultStartMinutes`), v3 (S21) added monthly-rate cards, v4 (S27)
added the `payments` array, and v5 (S28) added the `reminders` array. Older
snapshots are upgraded in-band on restore (missing arrays backfilled to `[]`);
v1 snapshots are rejected with a friendly version-mismatch message.

```ts
type DriveSnapshot = {
  schemaVersion: 5;
  exportedAt: string; // ISO 8601
  deviceId: string; // UUID v4 generated on first boot
  cards: Card[]; // each Card carries defaultStartMinutes + monthlyTotal
  entries: Entry[]; // each Entry carries startMinutes (0-1439)
  payments: Payment[]; // v4 (S27) — per-client monthly payment ledger
  reminders: Reminder[]; // v5 (S28) — dated reminders
  settings: Settings;
  tombstones?: Tombstone[]; // Soft-delete markers for LWW
};
```

> Backups are stored **as plaintext JSON** in the per-app-isolated
> `appDataFolder`. See PROJECT_PLAN §9.1 for the accepted data-at-rest
> trade-off and the optional-passphrase future option.

Files in the App Folder:

- `data.json` — the live state file. Read on bootstrap, rewritten on
  every sync push.
- `backups/<YYYY-MM-DDTHHmm>.json` — point-in-time snapshots. Auto-
  rotated to last 10.

The App Folder is **invisible in the Drive UI** — you cannot
accidentally delete the files. To inspect them, use the [Drive API
explorer](https://developers.google.com/drive/api/reference/rest/v3/files/list):

```
GET https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime,size)
```

To **wipe everything** for the app (e.g. start over with fresh
state): `drive.google.com` → ⚙ **Settings** → **Manage apps** →
"HourTrack" → **Delete hidden app data**.

## Repository layout

```
HourTrack/
├── apps/
│   └── web/                 # PWA shell (React + Vite + Tailwind)
├── packages/
│   ├── shared-types/        # @hourtrack/shared-types (entities)
│   └── shared-utils/        # @hourtrack/shared-utils (earnings, duration, dates)
├── docs/
│   ├── PROJECT_PLAN.md      # Locked product spec + architecture
│   ├── IMPLEMENTATION_PLAN.md  # Sprint tracker (APEX pipeline)
│   ├── PIPELINE_JOURNAL.md  # Per-sprint actual-vs-spec log
│   ├── google-cloud-setup.md
│   ├── vercel-env-setup.md
│   ├── SELF_HOST.md
│   ├── SMOKE_TEST.md
│   └── lighthouse-baseline.md
├── sprints/                 # APEX sprint specs (S01-S31)
├── scripts/                 # i18n parity check + placeholder icon generator
└── .github/workflows/
    └── ci.yml               # Lint + typecheck + test + build
```

## Scripts

| Command                  | Purpose                                            |
| ------------------------ | -------------------------------------------------- |
| `pnpm dev`               | Run all dev pipelines (currently only `apps/web`). |
| `pnpm build`             | Turbo build across all packages.                   |
| `pnpm lint`              | ESLint flat-config across the workspace.           |
| `pnpm typecheck`         | TS strict typecheck across the workspace.          |
| `pnpm test`              | Vitest unit tests (941 in `apps/web`).             |
| `pnpm e2e`               | Playwright E2E (against `pnpm preview` build).     |
| `pnpm format`            | Prettier write.                                    |
| `pnpm i18n:check`        | Asserts uk/en/es locale keys are aligned.          |
| `pnpm icons:placeholder` | Regenerates placeholder PWA PNG icons offline.     |

## i18n

Three locales: `uk` (default), `en` (fallback), `es`. Locale files
live in `apps/web/src/locales/`. The repo enforces key parity via
`pnpm i18n:check` (also wired into CI). Add a key to all three files
together; missing keys break the i18n fallback chain.

The native-speaker review pass for `uk` and `es` is a **v1.1
followup** — translations were authored mechanically with care taken
to match the three locales' key surfaces, but a native-speaker copy
review hasn't happened.

## Privacy

HourTrack does NOT collect telemetry. No analytics. No error
reporting (no Sentry, no LogRocket, no Datadog). The only outbound
network traffic from your browser goes to:

- `accounts.google.com` — sign-in UI.
- `oauth2.googleapis.com` — token exchange.
- `openidconnect.googleapis.com` — user info (your name + avatar).
- `www.googleapis.com` — your Drive App Folder + your "HourTrack"
  calendar. The scopes restrict this to ONLY the data HourTrack
  itself created.

You can verify this in DevTools → **Network**. There are zero other
hosts.

## Roadmap

v1.0.0 is feature-complete for the 26 user requirements documented
in `PROJECT_PLAN.md` section 2.

Post-v1.0.0 followups (tracked in `docs/PIPELINE_JOURNAL.md`):

- Native-speaker i18n review for `uk` + `es`.
- Lighthouse-in-CI bundle-size regression gate.
- Webkit + Firefox Playwright projects.
- Restore round-trip Playwright spec.
- Optional custom-domain deployment guide.

## License

Personal project. No license granted — fork freely for your own
personal use; do not redistribute as a commercial product.
