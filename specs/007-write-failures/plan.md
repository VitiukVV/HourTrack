# Implementation Plan: Write failures are never silent

**Spec**: `specs/007-write-failures/spec.md`

## Design

1. **Settings hook** — `onError` in `useUpdateSettingsMutation`: `console.error` + `toast.error(i18n.t('common.saveFailed'))`.
   LanguageSwitcher keeps its `.catch` only to stop the rejection (no second log/toast); InterfaceSection
   switches to `mutate`.
2. **`disconnectCalendar(db)`** in `lib/db/repos/settings.ts`: `db.transaction('rw', settings, entries)`
   around `updateSettings(… hourtrackCalendarId: null)` + `resetCalendarSyncFields`. CalendarSection's
   mutation calls it, then enqueues `pushDataJson` (what the settings hook did for it).
3. **Lint** — selector `UnaryExpression[operator='void'] > CallExpression[callee.property.name='mutateAsync']`.
   `no-restricted-syntax` options are replaced by later blocks for the same file, so the selector is
   added both to a base block for `src/**` and to every `layerBoundary()` block.
4. **Global net** — `app/installUnhandledRejectionToast.ts`, called from `main.tsx`; ignores
   `AbortError`.
5. **Reminders** — scheduler's toast action passes `onError` like the banner; `notified` gets an
   `onError` log.
6. **Read errors** — DayPickerModal and EntryEditModal branch on `isError` first.
7. **Release** — 1.7.1, changelog entry, `common.saveFailed` / `common.unexpectedError` / release
   copy in en/uk/es.
