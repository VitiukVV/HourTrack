# V2 Feature Plan — 8 нових вимог

> **Статус:** locked. Рішення прийняті 2026-05-15.
> **Дата:** 2026-05-15.
> **Контекст:** після завершення S14 (Vercel deploy) користувач сформулював 8 змін до продукту. Цей документ — план їх імплементації.

## Locked-in рішення

| #   | Питання                                     | Рішення                                                                                            |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Модель часу для #1                          | **Варіант B** — час на ентрі (`startMinutes`), картка має дефолт (`defaultStartMinutes`).          |
| 2   | Backward-compat для існуючих ентрі без часу | **Не потрібна** — розробка ще триває, продакшну немає. Можна зробити поле обов'язковим.            |
| 3   | Експорт у CSV/Excel у Reports               | **Прибрати повністю.** Жодного експорту не лишаємо.                                                |
| 4   | Чарти у Reports + залежність Recharts       | **Прибрати все — і компоненти, і `recharts` з `package.json`.**                                    |
| 5   | Що показує таблиця у Reports (#6)           | **Кожен окремий запис (entry-row)**, не агрегація. Колонки: дата, проект, години, сума.            |
| 6   | Мобільний WeekView (#7)                     | **Agenda view** — вертикальний список ентрі тижня, групований за днем (як Google Calendar mobile). |
| 7   | Послідовність спринтів                      | **S15 → S16 → S17 → S18** (див. таблицю нижче). S15 стартує першим.                                |

## 8 вимог (як їх сформулював користувач)

1. У картці вказувати години роботи (наприклад, з 12 по 14) і в Google Calendar відзначати саме цей часовий проміжок.
2. Покращити відображення на мобільних — зробити пріоритет на мобільні розширення.
3. У Reports прибрати кнопку і функціонал експорту в Excel.
4. У Reports прибрати функціонал з чартами.
5. У Reports залишити агрегацію за загальними годинами + загальною сумою заробленого. При виборі однієї картки — дані за цей проект; має працювати і мульти-картковий вибір.
6. На сторінці Reports після вибору періоду показувати замість чартів таблицю з колонками: **дата, назва проекту, кількість годин, сума**.
7. У календарі при виборі сортування «тиждень» покращити візуал саме на мобільних (приклад — Google Calendar).
8. Користувач має мати можливість редагувати кожну окрему картку, проставлену в календарі. Тобто: він проставив картки в календарі, після натискає на конкретну (наприклад, 10:00–12:45), редагує **тільки її** і зберігає. Основні картки в хедері лишаються незмінними.

---

## Аудит проти поточного коду

> Файлові посилання — для зручності навігації в IDE.

### #1 — Часові вікна на картках/ентрі + dateTime події в Calendar

**Що зараз:**

- `Card` зберігає лише `defaultDurationMin` (наприклад, 480 хв = 8 год) — без часу доби.
- `Entry.durationMin` — теж тільки тривалість.
- `apps/web/src/features/calendar-sync/buildEvent.ts:85-86` створює **all-day** події в Google Calendar (`start: { date }, end: { date + 1d }`).

**Рішення:** **Варіант B** — час на ентрі (`Entry.startMinutes`), картка має дефолт (`Card.defaultStartMinutes`). При створенні ентрі копіюється дефолт з картки; конкретну ентрі можна редагувати (synergy з #8).

**Що змінити:**

- `packages/shared-types/src/card.ts` — додати `defaultStartMinutes: number` (наприклад, 600 = 10:00).
- `packages/shared-types/src/entry.ts` — додати `startMinutes: number`. Обов'язкове поле; при створенні беремо з `card.defaultStartMinutes`.
- Dexie schema bump + міграція в `apps/web/src/lib/db/`. Підняти `schemaVersion`. Існуючі рядки можна зачистити (backward-compat не потрібна).
- `apps/web/src/features/calendar-sync/buildEvent.ts` — заміна `{ date }` → `{ dateTime, timeZone }`. `dateTime` рахується з `entry.startMinutes + entry.durationMin` у локальній TZ. Прибрати весь all-day-варіант.
- `apps/web/src/features/entries/EntryEditor.tsx` — start-time input (HH:MM picker).
- `apps/web/src/features/cards/CardEditor.tsx` (де редагуються картки) — default-start-time input.
- Drive snapshot (`apps/web/src/features/backup/`) — bump format version. Старі снепшоти просто не імпортуємо (доки розробка).
- Тести: оновити existing card/entry/buildEvent тести + додати нові.

**Розмір:** структурний, окремий спринт. APEX-метрика — ~2 спринти типу S04 (зведено до одного S16 нижче — без backward-compat роботи).

**Cross-cutting impact:**

- Calendar sync (формат подій змінюється — все time-bound, без all-day гілки).
- Sync queue (нічого не ламається — payload-shape inside an enqueued op).
- Drive backup (нова версія snapshot формату; старі несумісні).

---

### #2 — Mobile-first UI polish

**Що зараз:**

- Tailwind використовується, але **breakpoints дуже зрідка**. Приклади:
  - `apps/web/src/pages/Reports.tsx:91`: `grid grid-cols-1 gap-4 xl:grid-cols-2` — один з небагатьох responsive шаблонів.
  - `apps/web/src/features/calendar/WeekView.tsx:61`: `grid grid-cols-7` — **завжди** 7 колонок, без mobile варіанту.
  - `apps/web/src/features/calendar/MonthView.tsx`: те ж саме, фіксовано 7 колонок full-width.
  - Чарти Reports: `h-72` (288 px) — фіксована висота навіть на маленькому екрані.
- Немає pattern-у "hide on mobile / show on desktop" для desktop-only елементів.

**Що змінити:**

- Прохід по основних views з mobile-first підходом:
  - `MonthView` — менша висота клітинок на mobile, скорочені назви днів.
  - `WeekView` — див. #7 нижче.
  - `Reports` — single-column на mobile, multi на desktop.
  - `EntryEditor` — modal vs повна сторінка на mobile.
- Глобальні tweaks: typography scale, button sizes, gaps.

**Розмір:** середній. Не потребує schema-змін, чистий UI. ~1 спринт.

**Cross-cutting impact:** немає.

---

### #3 — Прибрати експорт (CSV + Excel)

**Що зараз:**

- В коді Excel-експорту нема, є лише CSV: `apps/web/src/features/reports/CsvExportButton.tsx` + `exportCsv.ts`.
- В `package.json` нема `xlsx`/`exceljs` залежностей.

**Рішення:** прибрати весь експорт повністю (CSV теж).

**Що змінити:**

- Видалити `CsvExportButton.tsx` + `exportCsv.ts`.
- Прибрати рендер кнопки з `apps/web/src/pages/Reports.tsx`.
- Видалити related i18n ключі (`reports.export.*`) з `apps/web/src/locales/{en,uk,es}.json`.
- Видалити пов'язані тести (`exportCsv.test.ts`, якщо є).

**Розмір:** тривіально, ~30 хв.

---

### #4 — Прибрати чарти з Reports

**Що зараз:**

- `apps/web/src/features/reports/ReportsBarChart.tsx` — Recharts BarChart (стек по картках, X = active-days, Y = hours).
- `apps/web/src/features/reports/ReportsPieChart.tsx` — Recharts PieChart (earnings розподіл).
- Підключені в `apps/web/src/pages/Reports.tsx:92-94`.

**Рішення:** прибрати все, включно з залежністю.

**Що змінити:**

- Видалити обидва компоненти + тести (`ReportsBarChart.test.tsx`, `ReportsPieChart.test.tsx`).
- Прибрати їх з `Reports.tsx`.
- Видалити `ReportsRoute.tsx` lazy-import (якщо він був заради код-сплітингу Recharts).
- `pnpm remove recharts` у `apps/web` → видалити з `package.json` + `pnpm-lock.yaml`.
- Перевірити що bundle більше не містить Recharts (`pnpm build` + перегляд `dist/assets`).

**Розмір:** тривіально, ~30 хв включно з видаленням залежності.

**Cross-cutting impact:** менший bundle (~60 kB gzipped — Recharts достатньо вагомий).

---

### #5 — Агрегації за загальними годинами + сумою

**Що зараз:** ✅ **вже реалізовано**.

- `apps/web/src/features/reports/useReportData.ts` — `computeReport()` групує за карткою + фільтр.
- `apps/web/src/features/reports/ReportsMetrics.tsx` — рендер `Total time` + `Total earnings`.
- `apps/web/src/features/reports/ReportsFilters.tsx` — мульти-картковий вибір + период + archived toggle.

**Що змінити:** нічого.

---

### #6 — Таблиця "дата, проект, години, сума" (entry-row, не агрегація)

**Що зараз:** часткова реалізація.

- `apps/web/src/features/reports/ReportsTable.tsx` має таблицю, але **агреговану по картці** (Card / Time / Rate / Earnings).

**Рішення:** таблиця показує **кожен окремий entry** як рядок. Без агрегації по групах (тотали лишаються в `ReportsMetrics` зверху).

**Що змінити:**

- У `useReportData.ts` додати output поле `entries: Array<{ id, date, card, durationMin, earnings }>` — плоский список ентрі періоду, відсортований за датою. Існуючі `byCard` тотали для `ReportsMetrics` лишити.
- Перебудувати `ReportsTable.tsx` під колонки: **Date / Project / Hours / Sum**. Кожен рядок — один entry. Project = `card.name` з кольоровим chip.
- Sort: за `date` ASC, у межах одного дня — за `startMinutes` ASC (після S16; до того — будь-який стабільний tie-break).
- Empty state: "Немає записів за вибраний період".

**Розмір:** малий-середній. ~1 день.

**Cross-cutting impact:** немає.

---

### #7 — Мобільний WeekView у стилі Google Calendar

**Що зараз:**

- `apps/web/src/features/calendar/WeekView.tsx:61` — завжди `grid-cols-7`. На телефоні (375 px ширина) це 53 px на день — не читабельно.
- Немає окремої mobile-агенди.

**Рішення:** **Agenda view** на мобільному (вертикальний список ентрі тижня, групований за днем, як "Schedule" режим у Google Calendar mobile).

**Що змінити (для Agenda view):**

- Новий компонент `WeekViewAgenda.tsx` для mobile.
- `WeekView.tsx` — conditional render: agenda на mobile, grid-7 на desktop (через CSS `hidden md:grid` / `md:hidden`).
- Можна share `EntryChip` між обома layouts.

**Розмір:** середній. ~1 день для agenda view.

**Cross-cutting impact:** немає.

---

### #8 — Per-entry edit на календарі (modal tap)

**Що зараз:**

- `apps/web/src/features/calendar/EntryChip.tsx` рендерить ентрі на MonthView/WeekView, **read-only**. Клік нічого не робить.
- Редагувати ентрі можна тільки через перехід на `/day/:date` → `apps/web/src/pages/DayPage.tsx` (повна форма з усіма ентрі дня).

**Що змінити:**

- Додати click handler на `EntryChip` → відкриває modal.
- Modal — обгортка над існуючим `EntryEditor` (`apps/web/src/features/entries/EntryEditor.tsx`) для одного ентрі.
- Save/delete через існуючі мутації (`useEntries.ts`) — sync queue вже все робить.
- Кнопка "Open day" в modal для повного перегляду дня (опціонально).

**Synergy з #1:** якщо #1 додає start-time на ентрі, цей modal має містити цей input. Тобто #8 краще робити **після** #1 (інакше modal доведеться переробляти).

**Розмір:** малий-середній (без #1: ~півдня). Зі start-time: ~1 день, але разом з #1.

**Cross-cutting impact:** немає (UI pattern addition).

---

## Зведена таблиця

| #   | Вимога                          | Розмір          | Готово зараз                 | Залежить від          | Спринт   |
| --- | ------------------------------- | --------------- | ---------------------------- | --------------------- | -------- |
| 1   | Time window + Calendar dateTime | **Структурний** | 0%                           | —                     | S16      |
| 2   | Mobile polish                   | Середній        | ~10% (рідкі breakpoints)     | бажано після #1 та #7 | S18      |
| 3   | Прибрати експорт (CSV + Excel)  | Тривіальний     | 0% (CSV є, треба прибрати)   | —                     | S15      |
| 4   | Прибрати чарти + Recharts dep   | Тривіальний     | 0%                           | —                     | S15      |
| 5   | Aggregations totals             | —               | ✅ 100%                      | —                     | (готово) |
| 6   | Entry-row table                 | Малий-середній  | ~30% (table є, формат інший) | —                     | S15      |
| 7   | Mobile WeekView (agenda)        | Середній        | 0%                           | —                     | S18      |
| 8   | Per-entry edit modal            | Малий-середній  | 0% (DayPage є, modal нема)   | після #1              | S17      |

---

## Послідовність спринтів (locked)

| Спринт                                    | Зміст                                                                                                          | Розмір         | Чому в цьому порядку                                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S15 — Reports cleanup**                 | #3 (видалити CSV) + #4 (видалити чарти + Recharts) + #6 (entry-row table)                                      | малий          | Швидка перемога: чистий Reports, менший bundle. Нульова залежність від інших змін. Спрощує наступні спринти (Reports перестане бути зоною ризику).                        |
| **S16 — Card/Entry time window**          | #1 (`startMinutes` на ентрі + `defaultStartMinutes` на картці + Calendar `dateTime` + Dexie/Drive schema bump) | **великий**    | Найцінніша і найбільша зміна. Без backward-compat (рішення #2) обсяг скорочується до ~1 спринту S04-стилю. Має бути до S17, щоб per-entry modal одразу містив time input. |
| **S17 — Inline entry edit modal**         | #8 (modal над `EntryChip` з повним полем редагування включно з `startMinutes`)                                 | малий-середній | Після S16: modal одразу включає time input. Підготовка до mobile (modal — primary edit UX на телефоні).                                                                   |
| **S18 — Mobile polish + WeekView agenda** | #2 (mobile-first проход через MonthView/Reports/forms) + #7 (Agenda view для WeekView mobile)                  | середній       | Останній: проход бачить фінальний UI зі start-time, modal-ом, новою таблицею Reports.                                                                                     |

**Загалом:** 4 спринти за стилем APEX. S15 + S17 — невеликі (1-2 дні); S18 — середній (~3 дні); S16 — найбільший (~1 тиждень, schema + sync + UI).

---

## Наступний крок

Стартую з **S15 — Reports cleanup** (видалення CSV + чартів + Recharts + перебудова таблиці під entry-row layout).

Оформлю спрінт-док `sprints/S15.md` за зразком S01–S14 (з task-таблицею, acceptance criteria, file paths). Скажи "go S15" — і запускаю.
