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

/**
 * The SyncManager's `lastError` while the shared Drive file is in a newer
 * format than this build reads (spec 016 FR-008). A stable code, not a
 * message: the UI maps it to `sync.updateRequired`.
 */
export const SYNC_UPDATE_REQUIRED = 'SYNC_UPDATE_REQUIRED';

function isAuthError(error: string | null | undefined): error is string {
  return !!error && AUTH_ERROR_RE.test(error);
}

/** A localized replacement for a known error, or `null` to show it as is. */
function knownErrorText(t: (key: string) => string, error: string | null | undefined) {
  if (error === SYNC_UPDATE_REQUIRED) return t('sync.updateRequired');
  if (isAuthError(error)) return t('googleCalendar.syncErrorAuth');
  return null;
}

/** The error as the user should read it: a hint for a known error, else unchanged. */
export function syncErrorDetail<E extends string | null | undefined>(
  t: (key: string) => string,
  error: E,
): E | string {
  return knownErrorText(t, error) ?? error;
}

/** The entry editor's sync warning. */
export function syncErrorMessage(t: (key: string) => string, syncError: string | null): string {
  const known = knownErrorText(t, syncError);
  if (known !== null) return known;
  const prefix = t('googleCalendar.syncError');
  return syncError ? `${prefix}: ${syncError}` : prefix;
}
