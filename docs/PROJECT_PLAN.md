# HourTrack — Project Plan

> **Status:** v4 — Requirements locked, ready for pipeline
> **Last updated:** 2026-05-14
> **Language:** English (for pipeline agent consumption)

---

## 1. Project Goal

Personal PWA for tracking work hours with:

- Calendar interface (month/week) with visual markers on worked days
- "Cards" concept (projects) — created in header, "applied" to days via active-card click pattern
- Reports by day / week / month / custom range (year = custom preset)
- **Google-only** authentication with long-lived sessions
- Google Calendar sync (cascade delete when entry is deleted)
- Data storage and auto-backup on user's Google Drive (App Folder)
- Trilingual: Ukrainian (uk) / English (en) / Spanish (es)
- Universal date format `DD.MM.YYYY` across all locales

---

## 2. User Requirements (final)

1. On open — current month with markers on days that have work entries (Google Calendar style)
2. Header contains card create/edit functionality. After creating a card, user can click it to activate, then click calendar days to apply it
3. Separate "Reports" tab — grouped info by cards over period (Day / Week / Month / Custom; Year is a Custom preset)
4. Card structure: name, default work hours per day (editable per-entry), rate (`hourly` OR `fixed` total), optional default note
5. Trilingual UA / EN / ES. Dates always in `DD.MM.YYYY` (e.g., `14.05.2026`)
6. Authentication via **Google only** — no email/password. Session persists as long as possible; logout only via manual Settings action
7. Backup to user's Google Drive. Manual backup button + automatic backup **every 3 days** by default
8. Currency: **EUR** (single)
9. Deleting an entry in the app deletes the corresponding Google Calendar event
10. Week starts on **Monday**
11. Home screen has **Month** and **Week** view modes with prev/next navigation and "Today" button
12. Reports: default = current month, all cards. Filter by 1+ cards. Show data only for days with activity
13. **Custom payment per entry:** card rate stays, but each entry has a checkbox "do not calculate by hours" → user enters actually paid amount (may exceed `hours × rate`)
14. **Notes:** card-level default note + per-entry note. Days with note get a visual marker in the calendar
15. **Soft delete for cards** with restore functionality
16. **+N more in month cell** → opens dedicated day page (Google Calendar style)
17. **Day click without active card** → modal to pick existing card OR create new card inline
18. **Onboarding:** guided tour on first login
19. **PWA icons/branding:** generated programmatically (low priority)
20. **Domain:** any default Vercel domain
21. **Time format:** display as `{H}H {M}M` (e.g., `2H 45M`), input as separate Hours and Minutes fields
22. **Calendar event title format:** `{cardName} | {H}H {M}M | {amount} EUR` (e.g., `Raquel | 2H 45M | 36 EUR`)
23. **No drag-to-select multiple days** — single click-by-click pattern is sufficient
24. **Color palette for cards:** 12 preset colors (no free picker)
25. **Archived cards in reports:** toggle "Show archived" is sufficient for v1
26. **Fixed-rate distribution in reports:** proportional to hours (same as hourly), to be refined during review

---

## 3. Locked Decisions

| Topic | Decision |
| ----------------------------- | ------------------------------------------------------------------- | --------- | ------------- |
| App type | PWA |
| Authentication | Google OAuth via GIS only |
| Session | Persistent (PKCE refresh + silent re-auth), logout only manual |
| Currency | EUR (single) |
| Languages | uk, en, es |
| Date format | `DD.MM.YYYY` everywhere |
| Time format | `{H}H {M}M` display, dual-input (Hours + Minutes) |
| Storage unit | Minutes (integer) in DB |
| Week start | Monday |
| Project entity name in UI | **Card** |
| Rate type | `hourly` OR `fixed` total — selected per card |
| Default hours | Card-level value, editable per entry |
| Custom payment | Per-entry override (bypasses `hours × rate`) |
| Notes | Card default + per-entry; calendar day marker if any entry has note |
| Card deletion | **Soft delete** with restore from Settings |
| Calendar event deletion | Cascade when entry is deleted |
| Backup | Manual + auto every **3 days** to Google Drive App Folder |
| View modes | Month / Week with prev/next + "Today" |
| Reports range | Day / Week / Month / Custom (Year = Custom preset) |
| Day click without active card | Modal: pick card or create new |
| +N more | Dedicated day page (Google Calendar style) |
| Onboarding | 3-step tour on first login |
| Drag-to-select days | Not supported (click-by-click only) |
| Card colors | Preset palette of 12 colors |
| Archive in reports | Toggle "Show archived" |
| Fixed-rate report split | Proportional to hours per entry |
| Architecture | **Variant B — pure PWA + Google Drive** (no Supabase) |
| Branding | Generated (low priority) |
| Domain | Vercel default |
| Calendar event title | `{cardName}                                                         | {H}H {M}M | {amount} EUR` |

---

## 4. Architecture

```
┌────────────────────────────────────────────┐
│              PWA (apps/web)                 │
│                                             │
│  ┌──────────────┐    ┌──────────────────┐  │
│  │   React UI   │ ↔  │  Dexie (cache)   │  │
│  └──────┬───────┘    └─────────┬────────┘  │
│         │                      │            │
│  ┌──────▼──────────────────────▼────────┐  │
│  │   Sync Manager (queue + retry + LWW) │  │
│  └──────┬──────────────────────┬────────┘  │
└─────────┼──────────────────────┼───────────┘
          │ Google Identity      │
          │ Services (PKCE)      │
          ▼                      ▼
   ┌──────────────┐      ┌─────────────────┐
   │ Google Drive │      │ Google Calendar │
   │   API v3     │      │    API v3       │
   │              │      │                 │
   │ appDataFolder│      │ Calendar:       │
   │  data.json   │      │  "HourTrack"    │
   │  backups/    │      │  events         │
   └──────────────┘      └─────────────────┘
```

### Storage model

- Google Drive **App Folder** (`spaces=appDataFolder`) is used as remote DB
- Primary state file: `data.json` (cards + entries + settings + version + deviceId)
- Backup folder: `backups/YYYY-MM-DDTHHmm.json` — keep last 10 snapshots, rotate oldest
- App Folder is invisible in Drive UI → user cannot accidentally delete files

### Sync flow

1. **Bootstrap:** GIS auth (PKCE) → access token + refresh token → save refresh token to IndexedDB
2. **Load:** read `data.json` from Drive → merge into Dexie (LWW by `updatedAt`)
3. **Edit:** user create/update/delete → write to Dexie immediately + enqueue sync
4. **Push:** Sync Manager runs in parallel:
   - Rewrites `data.json` (with ETag check for conflict detection)
   - Calls Calendar API for the corresponding event
5. **Conflict:** if remote `data.json` mtime > local baseline → pull → per-entry LWW merge → push
6. **Offline:** all operations work locally; sync queue drains when network returns
7. **Auto-backup:** check on each app open — if `now - lastBackupAt >= 3 days`, create new snapshot under `backups/`

### Persistent session

- GIS PKCE flow → refresh token + access token
- Refresh token stored in IndexedDB (not localStorage)
- On access token expiry (~1h) → silent refresh via refresh token
- If refresh fails → `prompt: 'none'` silent re-auth (works while user is signed into Google)
- Logout only on explicit button press in Settings → token revoke + clear local state

---

## 5. Technology Stack

| Layer                     | Technology                                                 |
| ------------------------- | ---------------------------------------------------------- |
| Frontend framework        | React 19 + Vite + TypeScript 5                             |
| Styles                    | Tailwind CSS 4 + shadcn/ui                                 |
| Server-side effects state | TanStack Query 5                                           |
| Client/UI state           | Zustand 5                                                  |
| Forms + validation        | react-hook-form + zod                                      |
| Dates                     | date-fns 4 (`weekStartsOn: 1`)                             |
| Charts                    | Recharts                                                   |
| Local storage             | Dexie (IndexedDB)                                          |
| PWA                       | vite-plugin-pwa (Workbox)                                  |
| i18n                      | i18next + react-i18next + i18next-browser-languagedetector |
| Calendar UI               | Custom component built on date-fns + Tailwind              |
| Auth                      | Google Identity Services (PKCE)                            |
| Drive / Calendar API      | `fetch` + `@types/gapi.client.*` types                     |
| Hosting                   | Vercel (free tier, default domain)                         |
| Monorepo                  | pnpm workspaces + Turbo                                    |
| Code quality              | ESLint 9 + Prettier + Husky + lint-staged                  |
| Testing                   | Vitest + React Testing Library                             |
| Icon/PWA assets           | Generated via PWA Asset Generator                          |

---

## 6. Monorepo Structure

```
HourTrack/
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/                  # routing, layout, providers
│       │   ├── features/
│       │   │   ├── auth/             # GoogleSignIn, useGoogleAuth, token refresh
│       │   │   ├── cards/            # CardsHeader, CardForm, useCards, archive/restore
│       │   │   ├── calendar/         # MonthView, WeekView, DayPage, DayCell
│       │   │   ├── entries/          # EntryEditor, custom payment toggle, notes
│       │   │   ├── reports/          # ReportsPage, charts, filters
│       │   │   ├── sync/             # SyncManager, drive client, calendar client
│       │   │   ├── backup/           # manual + auto backup, restore UI
│       │   │   ├── onboarding/       # 3-step tour
│       │   │   └── settings/         # SettingsPage, LanguageSwitcher, Logout
│       │   ├── components/ui/        # shadcn primitives
│       │   ├── lib/
│       │   │   ├── db/               # Dexie schema, queries
│       │   │   ├── google/           # gis.ts, drive.ts, calendar.ts
│       │   │   ├── date.ts           # DD.MM.YYYY format, weekStartsOn: 1
│       │   │   ├── duration.ts       # minutes ↔ "H M" formatting
│       │   │   ├── earnings.ts       # hourly / fixed / custom payment logic
│       │   │   └── colors.ts         # 12-color palette + Google Calendar colorId mapping
│       │   ├── locales/
│       │   │   ├── uk.json
│       │   │   ├── en.json
│       │   │   └── es.json
│       │   ├── hooks/
│       │   └── types/
│       ├── public/
│       └── package.json
│
├── packages/
│   ├── shared-types/                 # @hourtrack/shared-types
│   │   └── src/
│   │       ├── card.ts
│   │       ├── entry.ts
│   │       ├── settings.ts
│   │       ├── snapshot.ts
│   │       └── index.ts
│   └── shared-utils/                 # @hourtrack/shared-utils
│       └── src/
│           ├── earnings.ts
│           ├── duration.ts
│           ├── date-range.ts
│           └── index.ts
│
├── docs/
│   ├── PROJECT_PLAN.md
│   └── google-cloud-setup.md
│
├── .husky/
├── .github/workflows/
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .prettierrc
├── package.json
└── README.md
```

---

## 7. Data Model

### 7.1 Entities

```ts
// packages/shared-types/src/card.ts
export type RateType = 'hourly' | 'fixed';

export interface Card {
  id: string; // uuid v4
  name: string;
  color: string; // hex, must match one of 12 preset palette colors
  defaultDurationMin: number; // default minutes per day, e.g. 480 for 8h
  rateType: RateType;
  hourlyRate: number | null; // EUR/h, required if rateType='hourly'
  fixedTotal: number | null; // EUR for entire scope, required if rateType='fixed'
  defaultNote: string | null; // optional default note
  isArchived: boolean; // soft delete flag
  archivedAt: string | null; // ISO timestamp when archived
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// packages/shared-types/src/entry.ts
export type SyncStatus = 'pending' | 'synced' | 'error';

export interface Entry {
  id: string; // uuid v4
  cardId: string;
  date: string; // YYYY-MM-DD (ISO local date)
  durationMin: number; // actual minutes worked on this day
  // Custom payment override
  useCustomPayment: boolean; // if true → earnings = customPayment
  customPayment: number | null; // EUR, overrides hours × rate when useCustomPayment=true
  // Per-entry note
  note: string | null; // independent from card.defaultNote
  // Calendar sync
  googleEventId: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  // Audit
  createdAt: string;
  updatedAt: string;
}

// packages/shared-types/src/settings.ts
export type Language = 'uk' | 'en' | 'es';
export type Theme = 'system' | 'light' | 'dark';
export type CalendarView = 'month' | 'week';

export interface Settings {
  language: Language;
  theme: Theme;
  defaultView: CalendarView;
  hourtrackCalendarId: string | null;
  // Backup
  autoBackupEnabled: boolean; // default: true
  autoBackupIntervalDays: number; // default: 3
  lastBackupAt: string | null;
  // Sync
  lastSyncAt: string | null;
}

// packages/shared-types/src/snapshot.ts
export interface DriveSnapshot {
  schemaVersion: 1;
  exportedAt: string;
  deviceId: string; // for conflict detection
  settings: Settings;
  cards: Card[]; // including archived
  entries: Entry[];
}
```

### 7.2 Earnings calculation

```ts
// packages/shared-utils/src/earnings.ts

export function earningsForEntry(entry: Entry, card: Card, allCardEntries: Entry[]): number {
  // 1. Custom payment always wins
  if (entry.useCustomPayment) {
    return entry.customPayment ?? 0;
  }

  const hours = entry.durationMin / 60;

  // 2. Hourly card → simple multiplication
  if (card.rateType === 'hourly') {
    return hours * (card.hourlyRate ?? 0);
  }

  // 3. Fixed card → distribute fixedTotal proportionally to hours
  //    among entries that DON'T have custom payment
  const total = card.fixedTotal ?? 0;
  const customSum = allCardEntries
    .filter((e) => e.useCustomPayment)
    .reduce((s, e) => s + (e.customPayment ?? 0), 0);
  const remaining = Math.max(0, total - customSum);

  const nonCustomMinutes = allCardEntries
    .filter((e) => !e.useCustomPayment)
    .reduce((s, e) => s + e.durationMin, 0);

  if (nonCustomMinutes === 0) return 0;
  return (entry.durationMin / nonCustomMinutes) * remaining;
}
```

### 7.3 Duration formatting

```ts
// packages/shared-utils/src/duration.ts

export function formatDuration(durationMin: number): string {
  const h = Math.floor(durationMin / 60);
  const m = durationMin % 60;
  return `${h}H ${m}M`;
}

export function parseDuration(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}
```

### 7.4 Date formatting

```ts
// apps/web/src/lib/date.ts
import { format } from 'date-fns';

export const DATE_FORMAT = 'dd.MM.yyyy';
export const WEEK_STARTS_ON = 1 as const; // Monday

export function formatDate(date: Date | string): string {
  return format(new Date(date), DATE_FORMAT);
}
```

### 7.5 Color palette

```ts
// apps/web/src/lib/colors.ts
export const CARD_COLORS = [
  '#EF4444', // red
  '#F97316', // orange
  '#EAB308', // yellow
  '#22C55E', // green
  '#10B981', // emerald
  '#06B6D4', // cyan
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#78716C', // stone
  '#0F172A', // slate
] as const;

// Mapping to Google Calendar colorId (1-11)
export const GOOGLE_CALENDAR_COLOR_MAP: Record<string, string> = {
  '#3B82F6': '1', // Lavender → blue
  '#22C55E': '2', // Sage → green
  '#8B5CF6': '3', // Grape → violet
  '#EC4899': '4', // Flamingo → pink
  '#EAB308': '5', // Banana → yellow
  '#F97316': '6', // Tangerine → orange
  '#06B6D4': '7', // Peacock → cyan
  '#78716C': '8', // Graphite → stone
  '#6366F1': '9', // Blueberry → indigo
  '#10B981': '10', // Basil → emerald
  '#EF4444': '11', // Tomato → red
  '#0F172A': '8', // slate → fallback to graphite
};
```

---

## 8. UX / Screens

### 8.1 Home — Calendar (`/`)

**Header (always visible):**

- Logo `HourTrack`
- View toggle: `[ Month | Week ]`
- Cards carousel:
  - `[ + ]` button → opens "Create card" modal
  - Chips of active (non-archived) cards with color indicator
  - Click on card chip → toggles **active state** (highlighted border)
  - Long-press / context menu → "Edit" / "Archive"
- Right icons: profile (Google avatar → menu with Settings/Logout), language switcher

**Month view body:**

- Title: `← May 2026 →` + `Today` button
- 7-column grid × 5-6 rows, Mon→Sun
- Day cell contains:
  - Day number (today is visually distinct)
  - Up to 3 colored bar chips for entries (label: card name + `H M`)
  - If >3 entries → `+N more` link → navigates to dedicated day page
  - Note icon in corner if any entry on this day has `note != null`
  - Footer of cell: total hours + total earnings for the day
- **Active card mode:** click day → creates entry with `card.defaultDurationMin`. Click same day again when same card is active → removes that entry (with confirmation).
- **No active card:** click day → opens DayPage (see 8.2)
- No drag-to-select; one click = one day action

**Week view body:**

- Title: `← 12.05 – 18.05 →` + `Today` button
- 7 columns (Mon-Sun) full height; each shows:
  - Day header: weekday name + `DD.MM`
  - List of entries: card color chip + name + `H M` + earnings + note icon if applicable
- Same active card mechanism as month view

**Mobile footer:** Tab bar — Calendar / Reports / Settings

### 8.2 Day Page (`/day/:date`)

Opened via `+N more` link or via day-click without active card.

- Page title: `Monday, 14.05.2026` (localized weekday name)
- Top buttons: `← Back to calendar`, `← Previous day / Next day →`
- Full list of entries for the day (no truncation):
  - Card color chip + name
  - Hours and Minutes inputs (inline editable)
  - Custom payment toggle + amount input (when enabled)
  - Note textarea (optional)
  - Calculated earnings (read-only)
  - Delete entry button (with confirm)
- `+ Add entry to this day` button → modal:
  - List of all non-archived cards (with color indicators)
  - `+ Create new card and add` button → inline card creation form
  - After selecting/creating → entry is created with default duration, focus moves to it

### 8.3 Reports (`/reports`)

**Sticky filters at top:**

- Period: `[ Day ] [ Week ] [ Month ] [ Custom ]` — default `Month`
- Date or range picker (formatted `DD.MM.YYYY`)
- Cards: multi-select chips (default: all active cards)
- Toggle: `Show archived cards` (default: off)

**Content:**

- Top metrics: `Total time: 42H 30M`, `Total earnings: 1,275.00 EUR`
- Bar chart: hours per day in range (stacked by card color)
- Pie chart: earnings distribution by card
- Table: row per card — `Name | Time (H M) | Base rate | Earnings (EUR)` — earnings include custom payment overrides
- Per req #12: days without activity are not plotted in charts

**Export:** `Export CSV` button

### 8.4 Settings (`/settings`)

**Profile:**

- Google avatar + email
- `Logout` button (revoke token, clear Dexie, redirect to `/login`)

**Interface:**

- Language: UA / EN / ES
- Theme: System / Light / Dark
- Default view: Month / Week

**Data:**

- Backup status: `Last backup: 11.05.2026 17:42`
- `Create backup now` button → manual backup to Drive
- Auto-backup: toggle ON/OFF + interval (default: every 3 days)
- Restore: list of snapshots from Drive → select → confirm → wipe + restore
- Export CSV (all data)

**Card archive:**

- List of archived cards with `Restore` button per row
- `Delete permanently` button (double confirm)

**Google Calendar:**

- Status: `Connected to "HourTrack" calendar`
- `Re-sync all entries` button
- `Disconnect Calendar` button (stops sync, does not delete existing events)

**About:**

- App version
- Granted Google scopes (transparency)

### 8.5 Login (`/login`)

- Single screen: centered "Sign in with Google" button (GIS)
- On first successful auth → onboarding tour

### 8.6 Onboarding tour

**Step 1:** "Create your first card" — highlight `+` button in header
**Step 2:** "Click a card to activate it" — highlight card chip
**Step 3:** "Click days in the calendar to log work" — highlight calendar cells
User can skip. Marked as seen → never shown again.

---

## 9. Google Integrations

### 9.1 Google Identity Services (GIS)

**OAuth scopes:**

- `openid email profile`
- `https://www.googleapis.com/auth/calendar.app.created` — create and manage only the app-created "HourTrack" calendar
- `https://www.googleapis.com/auth/drive.appdata` — read/write only in App Folder

**Flow:** Authorization Code with PKCE (yields refresh token in browser)

**Session strategy:**

- Refresh token persisted in IndexedDB (not localStorage)
- Auto-refresh access token before expiry
- Silent re-auth (`prompt: 'none'`) if refresh fails
- Lifetime: "as long as possible" — user never sees login screen until explicit Logout

**Client-side token storage — accepted trade-off (S31, Security L2):**
Tokens live in IndexedDB for **structured storage**, not for security isolation.
IndexedDB provides **no** XSS containment over localStorage — both are fully
readable by same-origin JavaScript. The real XSS mitigations are: a strict CSP
with no `script-src 'unsafe-inline'` (S29), zero HTML-injection sinks, and
short-lived (~1h) access tokens (under GIS `initTokenClient` there is no
long-lived refresh-token grant at runtime). Any comment claiming "IndexedDB =
XSS containment" is incorrect and was corrected in S31.

**Drive backup data-at-rest — accepted trade-off (S31, Security M1):**
Drive backups (`data.json` + `backups/*.json` in `appDataFolder`) store client
data — hourly rates, payment amounts, entry notes — **as plaintext JSON**. The
`appDataFolder` space is per-app isolated (other apps and the user's normal
Drive UI can't see it), but the data is readable by anyone who compromises the
user's Google account. For a **single-user personal tool** this is an explicit,
accepted trade-off: it keeps restore/portability trivial and avoids owning a
key-management story. If stronger at-rest protection is ever wanted, the
intended path is an **optional user passphrase** encrypting the snapshot with
WebCrypto AES-GCM (`crypto.subtle`, no custom crypto) before upload — deferred
as a future option, not a fix.

### 9.2 Google Calendar API

- On first use: create calendar with `summary: 'HourTrack'`, save ID to `Settings.hourtrackCalendarId`
- Entry → event mapping:
  - `summary`: `{cardName} | {H}H {M}M | {amount} EUR` (e.g., `Raquel | 2H 45M | 36 EUR`)
  - `start.date` / `end.date` (all-day; +1 day for end per Calendar convention)
  - `description`:
    ```
    Card: {cardName}
    Time: {H}H {M}M
    Rate: {rate logic — see below}
    Earnings: {amount} EUR
    Note: {note if present}
    ```
    Rate line:
    - `hourly` without custom: `{hourlyRate} EUR/h`
    - `fixed` without custom: `Fixed total: {fixedTotal} EUR (proportional split)`
    - any with custom: `Custom payment`
  - `colorId`: mapped from card color via `GOOGLE_CALENDAR_COLOR_MAP`
- On entry delete → `DELETE /events/{googleEventId}` (cascade per req #9)
- On entry update → `PATCH /events/{googleEventId}`
- On card update (rename, color) → bulk PATCH all entries' synced events

### 9.3 Google Drive API

- `spaces=appDataFolder` for all calls
- Files:
  - `data.json` — full state snapshot
  - `backups/YYYY-MM-DDTHHmm.json` — snapshot copies
- Metadata: `appProperties.schemaVersion=1`, `appProperties.deviceId`
- ETags used for conflict detection on write
- Auto-backup algorithm:
  - On every app start: check `settings.lastBackupAt`
  - If `(now - lastBackupAt) >= autoBackupIntervalDays` → trigger backup
  - Rotation: keep max 10 files in `backups/`, delete oldest

---

## 10. Implementation Phases (for pipeline)

### Phase 0 — Monorepo skeleton

**Goal:** Project scaffolding ready, "Hello World" deployed.

Tasks:

- Init pnpm workspace, Turbo, tsconfig.base, Husky, Prettier, ESLint
- Create `apps/web` (Vite + React + TS + Tailwind + shadcn) + `packages/shared-types` + `packages/shared-utils`
- Configure i18next with three empty locale files
- PWA manifest, generated icons via PWA Asset Generator, service worker
- Routing skeleton: `/login`, `/`, `/day/:date`, `/reports`, `/settings`
- GitHub Actions CI: lint + typecheck + test on PR

**Acceptance:** app installs on phone, displays "Hello World" in three languages with working language switcher, passes CI.

### Phase 1 — Local MVP (Dexie only, no Google)

**Goal:** Fully functional offline app.

Tasks:

- Dexie schema: `cards`, `entries`, `settings` stores with indexes
- Cards: CardsHeader with create/edit modal, activate (toggle highlight), archive, restore
- Calendar: MonthView and WeekView with prev/next navigation and Today button
- Active card mode (click day → create entry with default duration, click again → delete)
- DayPage at `/day/:date` with full entry list, inline editing
- EntryEditor: Hours + Minutes inputs, custom payment toggle + input, note textarea
- Day click without active card → modal with card picker + inline create option
- Reports page with all filters and charts (Recharts)
- Settings (no Google yet): language, theme, default view, card archive section
- Locales UK/EN/ES with `DD.MM.YYYY` and `H M` formatting everywhere
- Dark theme via Tailwind
- CSV export

**Acceptance:** all flows work without authentication, all 26 user requirements that don't require Google are met.

### Phase 2 — Google Auth + Drive sync

**Goal:** Cross-device sync via Drive, automatic backups.

Tasks:

- GIS PKCE integration, `/login` screen, login flow
- Refresh token storage (IndexedDB), silent re-auth, persistent session
- Drive client: read/write `data.json` in App Folder, ETag-based conflict detection
- SyncManager: offline queue, retry with exponential backoff, LWW merge per entry
- Settings: Backup section — manual backup, auto-backup toggle + interval, list of snapshots
- Restore-from-backup flow with double confirmation

**Acceptance:** signing in on two devices keeps data in sync via Drive, auto-backup creates a snapshot every 3 days.

### Phase 3 — Google Calendar sync

**Goal:** Entries appear and disappear in Google Calendar.

Tasks:

- Calendar client: auto-create "HourTrack" calendar on first use
- Sync on entry create/update/delete (cascade delete per req #9)
- Settings: Calendar status, "Re-sync all entries", "Disconnect Calendar"
- Color mapping (card hex → Google `colorId`)
- Event title and description per spec in 9.2

**Acceptance:** new entry shows up in Google Calendar with correct title format; deleting entry deletes event; renaming card updates all linked events.

### Phase 4 — Onboarding and polish

**Goal:** Production-ready release.

Tasks:

- 3-step onboarding tour on first login
- Empty states with helpful hints
- Performance: lazy-load Reports route, virtualize long entry lists
- E2E tests for golden paths (Vitest + Playwright optional)
- Production deploy to Vercel
- `README.md` with OAuth setup instructions for self-hosted rebuild
- `docs/google-cloud-setup.md` with step-by-step Google Cloud Console guide

**Acceptance:** brand-new user reaches their first logged entry within 1 minute of signup.

---

## 11. Out of Scope (explicitly NOT building)

- Real-time timer (start/stop)
- Multiple currencies (EUR only)
- Two-way Calendar sync (Calendar → app direction)
- Sharing / team collaboration
- Invoicing / PDF reports
- Push notifications
- Email/password login
- Custom backend (no Supabase, no NestJS)
- Drag-to-select multiple days
- Year preset button in Reports (Custom range covers it)
- Custom domain (Vercel default)
- Free color picker (12-color palette only)

---

## 11b. Sync indicator legend (S21)

The `SyncIndicator` widget (S19 moved it from the chrome header into the
**Settings → Backup** section, next to "Backup status") surfaces four
states. Knowing which is which avoids the "is my data even being saved?"
question — the indicator is now several taps off the home view, so
the legend is captured here as the discoverable reference.

| state     | visual        | meaning                                                                                                                            |
| --------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `idle`    | green dot     | Everything in sync. Most recent push succeeded; queue is empty.                                                                    |
| `syncing` | spinning dot  | A push is in flight (snapshot upload, Calendar create/update/delete, or bulk PATCH). Resolves in seconds.                          |
| `error`   | red dot + "!" | The last push failed and is being retried. Retry uses exponential backoff; the indicator persists until the next successful flush. |
| `offline` | gray dot      | The browser reports `navigator.onLine === false`. Edits queue locally; on reconnect the queue drains automatically.                |

The indicator widget lives at `apps/web/src/features/sync/SyncIndicator.tsx`
and is consumed by `BackupSection` (`apps/web/src/features/backup/`).
SyncManager state transitions are driven by
`apps/web/src/features/sync/SyncManager.ts` — see the source for the
authoritative event ordering.

---

## 12. References

- **Turborepo structure reference:** `C:\softermiiProjects\Reach-Adult-People` (tooling only, no backend)
- **Google Identity Services:** https://developers.google.com/identity/oauth2/web/guides/overview
- **Google Drive App Folder:** https://developers.google.com/drive/api/guides/appdata
- **Google Calendar API v3:** https://developers.google.com/calendar/api/v3/reference
- **vite-plugin-pwa:** https://vite-pwa-org.netlify.app/
- **shadcn/ui:** https://ui.shadcn.com/
- **date-fns:** https://date-fns.org/
- **react-i18next:** https://react.i18next.com/
- **PWA Asset Generator:** https://github.com/onderceylan/pwa-asset-generator
