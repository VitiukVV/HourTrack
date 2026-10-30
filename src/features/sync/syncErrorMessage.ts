/**
 * User-facing text for a stored sync error (spec 014).
 *
 * A 401 means the Google sign-in expired and could not be renewed — the raw
 * API message (English, with a URL) says nothing useful to the user, so it is
 * replaced by a localized hint. The stored `syncError` stays the raw message;
 * matching the stable `"<API> API error 401"` prefix also covers entries stamped
 * before this change.
 */
const AUTH_ERROR_RE = /^(Calendar|Drive) API error 401\b/;

function isAuthError(error: string | null | undefined): error is string {
  return !!error && AUTH_ERROR_RE.test(error);
}

/** The error as the user should read it: the sign-in hint for a 401, else unchanged. */
export function syncErrorDetail<E extends string | null | undefined>(
  t: (key: string) => string,
  error: E,
): E | string {
  return isAuthError(error) ? t('googleCalendar.syncErrorAuth') : error;
}

/** The entry editor's sync warning. */
export function syncErrorMessage(t: (key: string) => string, syncError: string | null): string {
  if (isAuthError(syncError)) return t('googleCalendar.syncErrorAuth');
  const prefix = t('googleCalendar.syncError');
  return syncError ? `${prefix}: ${syncError}` : prefix;
}
