/**
 * The text of the entry editor's sync warning (spec 014).
 *
 * A 401 means the Google sign-in expired and could not be renewed — the raw
 * API message (English, with a URL) says nothing useful to the user, so it is
 * replaced by a localized hint. The stored `syncError` stays the raw message;
 * matching the stable `"<API> API error 401"` prefix also covers entries stamped
 * before this change.
 */
const AUTH_ERROR_RE = /^(Calendar|Drive) API error 401\b/;

export function syncErrorMessage(t: (key: string) => string, syncError: string | null): string {
  if (syncError && AUTH_ERROR_RE.test(syncError)) return t('googleCalendar.syncErrorAuth');
  const prefix = t('googleCalendar.syncError');
  return syncError ? `${prefix}: ${syncError}` : prefix;
}
