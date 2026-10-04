# Аудит архітектури HourTrack

Дата: 2026-10-04. База: `main` @ `1680a43`. Метод: читання коду `apps/web/src` (~24k рядків без
тестів), граф імпортів між фічами, порівняння з my-diary (аудит
`my-diary/docs/audit/2026-10-02-architecture-and-pages-audit.md`, specs 003/004/028). Мета —
підтримуваність без зміни поведінки: кожен крок нижче — окрема FeatureBandit-фіча, внутрішній
рефакторинг без бампу версії й без «Що нового».

## 1. Що є зараз

```text
pages/ (7 файлів, пласко) ─► features/<домен>/ (16 доменів, пласко: UI + хуки + логіка поруч)
                                   │  TanStack Query (useQuery + 40× invalidateQueries)
                                   ▼
                           lib/db/queries.ts (1030 рядків, усі читання й записи) ─► Dexie
                           features/sync + lib/sync + lib/google ─► Drive / Calendar
packages/shared-types, packages/shared-utils (чисті типи й функції)
```

**Зберегти:** записи майже повністю йдуть через `queries.ts` (stamp `updatedAt`, tombstone,
`enqueueSyncOp`); `db` передається параметром (легко тестувати); `SyncManager` з ін'єкцією
`FakeDrive`; чисті функції в `packages/` з тестами; сторінки вже тонкі (крім `DayPage`).

## 2. Проблеми

| #   | Проблема                                                                                                                                                                                                                    | Де                                                                                                                                                                                                                                                                                                              | Наслідок                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Цикли між фічами**: `sync ↔ backup`, `sync ↔ calendar-sync`, `sync ↔ settings`, `auth → sync → … → auth`, `entries ↔ calendar`                                                                                            | `sync/SyncManager.ts`, `sync/bootstrap.ts` → `backup/validateSnapshot`; `sync/handlers/calendarOps.ts` → `calendar-sync/*`, а `calendar-sync/resyncAll.ts` → назад; `settings/useSettings.ts` → `SyncManager`, `sync/SyncIndicator.tsx` → `useSettings`; `entries/useEntries.ts` → `calendar/useEntriesInRange` | фічу не можна змінити чи протестувати ізольовано; `sync` фактично залежить від усього                                              |
| A2  | **Інверсія шарів**: `components/` імпортує `features/`                                                                                                                                                                      | `components/ui/{Day,Week,Month}Picker.tsx` → `features/calendar/calendarLocale`; `components/LanguageSwitcher.tsx` → `features/settings/useSettings`                                                                                                                                                            | спільні примітиви тягнуть доменний код                                                                                             |
| A3  | **`queries.ts` — моноліт**: 54 експорти з 7 доменів (cards, entries, payments, reminders, settings, syncQueue, tombstones)                                                                                                  | `lib/db/queries.ts`                                                                                                                                                                                                                                                                                             | кожна зміна домену — у файлі на 1000+ рядків; той самий A1 у my-diary закрито spec 004                                             |
| A4  | **Ручна інвалідація кешу**: дані з Dexie читаються через TanStack Query; 40 рядкових ключів (`['entries']`, `['cards']` …) розкидані по 13 файлах, плюс окрема шина `snapshotEvents` лише щоб інвалідувати після синку      | `features/*/use*.ts`, `auth/AuthProvider.tsx:56–60`, `sync/snapshotEvents.ts`                                                                                                                                                                                                                                   | забута інвалідація = застарілий UI (так уже був баг S29 / UR-29-2); my-diary прибрав TanStack Query 2026-07-12 саме з цієї причини |
| A5  | **Обходи data-layer**: прямий запис/читання `db.*` поза `lib/db`                                                                                                                                                            | `settings/CalendarSection.tsx:54–62` (масовий `db.entries.update` у компоненті), `sync/pruneTombstones.ts:19`, `sync/handlers/calendarOps.ts`, `pages/DayPage.tsx:75` (запит у сторінці)                                                                                                                        | записи без єдиного ядра; ці зміни не потрапляють у звичний шлях `updatedAt`/sync                                                   |
| A6  | **Межі шарів не перевіряються** — в `eslint.config.js` немає жодного `no-restricted-imports`                                                                                                                                | `eslint.config.js`                                                                                                                                                                                                                                                                                              | A1/A2 повертатимуться після кожної фічі                                                                                            |
| A7  | **Мовчазні збої**: 68 викликів `void f()` у UI-коді, 11 порожніх `catch {}`, немає глобального `unhandledrejection`                                                                                                         | `features/*`, `pages/*`                                                                                                                                                                                                                                                                                         | збій запису без тосту — користувач думає, що збережено                                                                             |
| A8  | **Пласка структура `app/`, `pages/`, `lib/`**: `app/` змішує оболонку, роутинг і хуки; `lib/` — 9 вільних файлів поруч із папками; `features/backup/validateSnapshot` і `features/sync/retention` — інфраструктура, не фіча | `app/`, `lib/`, `pages/`                                                                                                                                                                                                                                                                                        | важко знайти «де це живе»; my-diary закрив spec 028                                                                                |
| A9  | **«Товсті» компоненти**: стан форми, валідація й побічні ефекти в одному файлі                                                                                                                                              | `entries/EntryEditor.tsx` 647, `cards/CardForm.tsx` 583, `cards/CardsHeader.tsx` 337, `pages/DayPage.tsx` 334                                                                                                                                                                                                   | важко тестувати логіку окремо від рендеру                                                                                          |

## 3. Цільова архітектура

Шари (зверху вниз, імпорт лише вниз):

```text
app/        композиційний корінь: провайдери, роутинг, оболонка, запуск синку/планувальників
pages/      тонкі: маршрут → композиція компонентів фіч; без запитів до БД
features/   домени; між собою — лише через публічні модулі (хуки, компоненти), без циклів
components/ доменно-нейтральні UI-примітиви
lib/        інфраструктура без знання про домени: db, sync, google, i18n, hooks, utils
packages/   чисті типи й функції (без DOM / IndexedDB)
```

Цільова структура папок (за зразком my-diary spec 028, адаптовано):

```text
src/
  app/
    shell/        AppLayout, ErrorBoundary, ErrorScreen, DbInterruptedScreen, RequireAuth
    routing/      router, routes, useScrollRestoration, useStickyChromeHeight
    providers/    QueryClient/live-query, SyncOrchestrator (bootstrap після входу — зараз в AuthProvider)
  pages/<розділ>/ home/, day/, login/, payments/, reports/, settings/, whats-new/ — тест поруч
  features/<домен>/  як зараз; великі домени (sync, cards, entries) — підпапки за роллю
  components/     ui/ + EmptyState, ConfirmDialog
  lib/
    db/           schema, constants, dbStatus, mutate.ts (ядро), repos/<домен>.ts, queries.ts (barrel)
    sync/         snapshot, deviceId, validateSnapshot (з backup), retention, lwwMerge
    google/       як зараз
    i18n/         i18n, zodI18n, calendarLocale (з features/calendar)
    hooks/        як зараз
    utils/        utils, colors, date, scroll, noAutofill
```

Патерни:

- **Repository + спільне mutate-ядро** (A3, A5): `lib/db/mutate.ts` робить stamp `updatedAt`,
  tombstone і `enqueueSyncOp`; `repos/<домен>.ts` — читання й записи домену. `queries.ts`
  лишається barrel-реекспортом — жоден імпорт не ламається.
- **Observer у data-layer замість ручної інвалідації** (A4): або `useLiveQuery` (Dexie сам
  сповіщає UI про будь-яку зміну, включно з merge після синку → `snapshotEvents` зникає), або
  фабрика ключів `queryKeys.ts` + одна точка інвалідації. Див. §5.
- **Strategy / реєстр обробників для sync-черги** (A1): `SyncManager` знає лише інтерфейс
  `SyncOpHandler`; `calendar-sync` реєструє свій обробник з `app/providers`. Зникає цикл
  `sync ↔ calendar-sync`.
- **Composition root** (A1): старт синку після входу, планувальники бекапу й нагадувань
  підключаються в `app/`, а не в `AuthProvider` — `auth` перестає залежати від `sync`.
- **Controller-хуки** (A9): `useEntryEditorForm`, `useCardForm` тримають стан і сабміт; компонент
  лише рендерить. Чисту логіку — у `model`-функції з юніт-тестами.

## 4. Порядок робіт

Кожен крок — окрема фіча (`specs/<NNN-slug>/`), поведінка не змінюється, гейт
`pnpm lint && pnpm typecheck && pnpm test` + `pnpm build`.

| Крок | Що                                                                                                                                                                                                                                                                              | Закриває | Розмір |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| 1    | ESLint-межі (`no-restricted-imports`, як `layerBoundary()` у my-diary): `lib` ↛ features/pages/app/components; features/components ↛ pages/app; pages ↛ `@/lib/db/schema`. Одразу виправити A2 (`calendarLocale` → `lib`, `LanguageSwitcher` → `features/settings`) ✅ spec 002 | A2, A6   | S      |
| 2    | Структура папок `app/`, `pages/`, `lib/` за §3 — механічне перенесення, оновлення імпортів і конфігів ✅ spec 003                                                                                                                                                               | A8       | S–M    |
| 3    | Розрізати `queries.ts` на `mutate.ts` + `repos/*`; прибрати обходи A5 (`CalendarSection` → `resetCalendarSyncFields()` у repo, `pruneTombstones` → repo)                                                                                                                        | A3, A5   | M      |
| 4    | Розірвати цикли: `validateSnapshot`/`retention` → `lib/sync`; реєстр обробників sync-черги; оркестрація синку в `app/providers`; `useEntriesInRange` → `entries`                                                                                                                | A1       | M      |
| 5    | Шар читання: міграція на `useLiveQuery` по доменах (або фабрика ключів — §5)                                                                                                                                                                                                    | A4       | L      |
| 6    | Збої записів: lint-правило на `void` у UI (як my-diary spec 003), глобальний `unhandledrejection` → тост, ревізія 11 порожніх `catch`                                                                                                                                           | A7       | S      |
| 7    | Розвантажити `EntryEditor`, `CardForm`, `CardsHeader`, `DayPage` через controller-хуки                                                                                                                                                                                          | A9       | M      |

Кроки 1–2 найдешевші й дають каркас, на який лягають решта; крок 6 — найбільша користь для
довіри до даних за найменшу ціну, його можна робити будь-коли.

## 5. Рішення, які треба прийняти

1. **Читання даних (крок 5).** Обрано **A** (власник, 2026-10-04).
   - _A — `useLiveQuery` (рекомендовано)._ Як у my-diary: зникають 40 інвалідацій,
     `snapshotEvents` і цілий клас багів «UI не оновився». Ціна: переписати ~13 хуків і тести,
     що зараз створюють `QueryClient`. TanStack Query лишається тільки для мережевого
     (`useBackupsList` — список бекапів із Drive).
   - _B — лишити TanStack Query_, але ввести `queryKeys.ts` і інвалідувати з одного місця
     (data-layer подія після кожного запису). Дешевше, але ручна синхронізація кешу з БД
     залишається.
2. **`packages/shared-*`.** Монорепо з одним застосунком: 108 + 27 імпортів. Рекомендація —
   **залишити**: пакети чисті, протестовані, перенесення дає лише churn. Повернутися, якщо
   turbo/збірка почнуть заважати.
3. **Підпапки всередині фіч (`api/`, `model/`, `ui/`).** my-diary запропонував, але не
   впровадив. Для HourTrack — **не робити глобально**: домени по 5–12 файлів; підпапки лише
   для `sync` (вже є `handlers/`), `cards`, `entries`, коли вони ростуть.
